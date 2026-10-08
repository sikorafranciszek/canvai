/**
 * Store sceny — źródło prawdy dla silnika płótna.
 *
 * Decyzja: Zustand (a nie `useReducer`). Uzasadnienie w komentarzu do zadania;
 * krótko: drobnoziarniste selektory + akcje poza drzewem Reacta = brak
 * re-renderu całej sceny przy przeciąganiu jednego elementu (cel: 500 elem.).
 *
 * Konva renderuje TEN model (nie odwrotnie): każda zmiana przechodzi przez
 * akcje poniżej, które produkują nowy `SceneDocument` (patrz `shared/scene-ops`).
 */
import { create } from 'zustand'
import {
  addElement as addElementOp,
  commitHistory,
  createElementId,
  duplicateElements,
  moveElements,
  redoHistory,
  removeElements,
  reorderElement,
  undoHistory,
  updateElement,
} from '@shared/scene-ops'
import { emptySceneDocument, type SceneDocument, type SceneElement } from '@shared/scene'
import type { Tool } from '@shared/tools'
import { DEFAULTS, FONT_FAMILY } from '~/lib/scene/palette'
import { translate } from '~/i18n'

export type { Tool } from '@shared/tools'

export interface Camera {
  x: number
  y: number
  scale: number
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 }

interface SceneStore {
  document: SceneDocument
  selection: string[]
  tool: Tool
  camera: Camera

  past: SceneDocument[]
  future: SceneDocument[]

  canUndo: boolean
  canRedo: boolean

  setTool: (tool: Tool) => void
  setCamera: (camera: Camera) => void

  selectOnly: (ids: string[]) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  selectAll: () => void

  /** Dodaje element i zatwierdza krok historii. */
  addElement: (element: SceneElement) => void
  /** Aktualizacja bez historii — dla ciągłych gestów (drag/transform). */
  updateElementLive: (id: string, patch: Partial<SceneElement>) => void
  /** Zatwierdza gest jako jeden krok historii (start + live + commit). */
  commitGesture: (baseline: SceneDocument, next: SceneDocument) => void

  deleteSelection: () => void
  duplicateSelection: () => void
  moveSelection: (dx: number, dy: number) => void
  reorderSelection: (direction: 'forward' | 'backward') => void

  undo: () => void
  redo: () => void
  /** Ładuje dokument z serwera (bez historii) — używa BLA-9 przy GET sceny. */
  loadDocument: (document: SceneDocument) => void
  /**
   * Zmiany innych uczestników (scalone z lokalnymi). Zachowuje zaznaczenie;
   * historia cofania jest czyszczona — cofnięcie nie może skasować cudzej pracy.
   */
  /**
   * Scena po zmianach innych osób. `rebase` przelicza stany historii cofania na
   * nowej bazie (DAT-7) — Cofnij działa dalej i nie cofa cudzej pracy.
   */
  applyRemoteDocument: (
    document: SceneDocument,
    rebase?: (snapshot: SceneDocument) => SceneDocument
  ) => void
  /** Usuwa elementy o podanych id (używane przy kasowaniu assetu). */
  deleteElements: (ids: string[]) => void
  reset: () => void
}

function withSelection(next: SceneDocument, selection: string[]): string[] {
  const alive = new Set(next.elements.map((e) => e.id))
  return selection.filter((id) => alive.has(id))
}

export const useSceneStore = create<SceneStore>()((set, get) => ({
  document: emptySceneDocument(),
  selection: [],
  tool: 'select',
  camera: DEFAULT_CAMERA,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  setTool: (tool) => set({ tool }),

  setCamera: (camera) => set({ camera }),

  selectOnly: (ids) => set({ selection: ids }),
  toggleSelection: (id) => {
    const selection = get().selection
    set({
      selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id],
    })
  },
  clearSelection: () => set({ selection: [] }),
  selectAll: () => set({ selection: get().document.elements.map((e) => e.id) }),

  addElement: (element) => {
    const state = get()
    const next = addElementOp(state.document, element)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  updateElementLive: (id, patch) => {
    const next = updateElement(get().document, id, patch)
    set({ document: next, selection: withSelection(next, get().selection) })
  },

  commitGesture: (baseline, next) => {
    const hist = commitHistory({ document: baseline, past: get().past, future: get().future }, next)
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  deleteSelection: () => {
    const state = get()
    if (state.selection.length === 0) return
    const next = removeElements(state.document, state.selection)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      selection: [],
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  duplicateSelection: () => {
    const state = get()
    if (state.selection.length === 0) return
    const next = duplicateElements(state.document, state.selection)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  moveSelection: (dx, dy) => {
    const state = get()
    if (state.selection.length === 0) return
    const next = moveElements(state.document, state.selection, dx, dy)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  reorderSelection: (direction) => {
    const state = get()
    if (state.selection.length !== 1) return
    const next = reorderElement(state.document, state.selection[0], direction)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  undo: () => {
    const state = get()
    const hist = undoHistory({ document: state.document, past: state.past, future: state.future })
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      selection: withSelection(hist.document, state.selection),
      canUndo: hist.past.length > 0,
      canRedo: hist.future.length > 0,
    })
  },

  redo: () => {
    const state = get()
    const hist = redoHistory({ document: state.document, past: state.past, future: state.future })
    set({
      document: hist.document,
      past: hist.past,
      future: hist.future,
      selection: withSelection(hist.document, state.selection),
      canUndo: hist.past.length > 0,
      canRedo: hist.future.length > 0,
    })
  },

  loadDocument: (document) =>
    set({
      document,
      selection: [],
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    }),

  applyRemoteDocument: (document, rebase) =>
    set((state) => {
      const past = rebase ? state.past.map(rebase) : []
      const future = rebase ? state.future.map(rebase) : []
      return {
        document,
        selection: withSelection(document, state.selection),
        past,
        future,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
      }
    }),

  deleteElements: (ids) => {
    const state = get()
    if (ids.length === 0) return
    const next = removeElements(state.document, ids)
    const hist = commitHistory(
      { document: state.document, past: state.past, future: state.future },
      next
    )
    set({
      document: hist.document,
      selection: withSelection(next, state.selection),
      past: hist.past,
      future: hist.future,
      canUndo: hist.past.length > 0,
      canRedo: false,
    })
  },

  reset: () =>
    set({
      document: emptySceneDocument(),
      selection: [],
      camera: DEFAULT_CAMERA,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    }),
}))

/** Fabryka elementów — domyślne wartości per typ narzędzia. */
export function createElementForTool(tool: Tool, x: number, y: number): SceneElement {
  const base = { id: createElementId(), x, y, rotation: 0, opacity: 1 }
  switch (tool) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        width: 160,
        height: 100,
        fill: DEFAULTS.shapeFill,
        stroke: DEFAULTS.shapeStroke,
        strokeWidth: 1.5,
        cornerRadius: 8,
      }
    case 'frame':
      return {
        ...base,
        type: 'rectangle',
        width: 390,
        height: 640,
        fill: 'rgba(255, 255, 255, 0)',
        stroke: '#9b998f',
        strokeWidth: 1.5,
        cornerRadius: 12,
        frameName: translate('canvas.newFrame'),
      }
    case 'ellipse':
      return {
        ...base,
        type: 'ellipse',
        width: 140,
        height: 100,
        fill: DEFAULTS.shapeFill,
        stroke: DEFAULTS.shapeStroke,
        strokeWidth: 1.5,
      }
    case 'line':
      return {
        ...base,
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
        ],
        stroke: DEFAULTS.line,
        strokeWidth: 2,
      }
    case 'arrow':
      return {
        ...base,
        type: 'arrow',
        points: [
          { x: 0, y: 0 },
          { x: 120, y: 0 },
        ],
        stroke: DEFAULTS.arrow,
        strokeWidth: 2,
        arrowHeadSize: 10,
      }
    case 'freehand':
      return {
        ...base,
        type: 'freehand',
        points: [{ x: 0, y: 0 }],
        stroke: DEFAULTS.freehand,
        strokeWidth: 2.5,
      }
    case 'text':
      return {
        ...base,
        type: 'text',
        text: translate('canvas.newText'),
        fontSize: 24,
        fontFamily: FONT_FAMILY,
        fill: DEFAULTS.text,
        align: 'left',
      }
    case 'sticky':
      return {
        ...base,
        type: 'sticky',
        width: 200,
        height: 150,
        text: translate('canvas.newSticky'),
        fill: DEFAULTS.sticky,
        fontSize: 14,
      }
    default:
      return {
        ...base,
        type: 'rectangle',
        width: 160,
        height: 100,
        fill: DEFAULTS.shapeFill,
        stroke: DEFAULTS.shapeStroke,
        strokeWidth: 1.5,
        cornerRadius: 8,
      }
  }
}
