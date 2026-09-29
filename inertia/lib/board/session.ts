/**
 * Sesja tablicy — łączy silnik płótna (scene store) z backendem (API).
 *
 * Odpowiada za: wczytanie sceny przy mount, autosave z debounce, obsługę
 * konfliktu 409, upload plików (paste/drop/upload), karty linków i notatki
 * tekstowe, oraz listę assetów w panelu bocznym.
 *
 * Czysta logika (autosave, cykl uploadu) żyje w `shared/` i jest testowana
 * jednostkowo; tutaj jest tylko spięcie z fetch/XHR i zustand.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { AutosaveEngine, AutosaveConflictError, type SaveStatus } from '@shared/autosave'
import {
  createPendingUpload,
  resolveUploadResult,
  type PendingUpload,
  type UploadSource,
} from '@shared/upload-state'
import { validateClientFile, type ClientFileRejectReason } from '@shared/asset-utils'
import { createElementId } from '@shared/scene-ops'
import type { SceneDocument, SceneElement, SceneStickyElement } from '@shared/scene'
import { useSceneStore, DEFAULT_CAMERA, type Camera } from '~/lib/scene/store'
import { getElementBounds } from '~/lib/scene/geometry'
import {
  createLinkAsset,
  deleteAsset as apiDeleteAsset,
  getScene,
  listAssets,
  putScene,
  updateAssetNote as apiUpdateNote,
  uploadFiles,
  type AssetDto,
  pruneAssets,
} from './api'
import { DEFAULTS } from '~/lib/scene/palette'

export type BoardSaveStatus = SaveStatus | 'dirty' | 'loading'

/** Szerokość panelu assetów + wysokość headera/toolbara — do wyśrodkowania. */
const PANEL_WIDTH = 304
const CHROME_HEIGHT = 100

/** Dłuższa krawędź obrazu wstawianego na płótno (px sceny) i odstęp między obrazami. */
const MAX_IMAGE_EDGE = 960
const IMAGE_GAP = 48

interface BoardState {
  boardId: number | null
  initialized: boolean
  version: number
  saveStatus: BoardSaveStatus
  assets: AssetDto[]
  assetsLoading: boolean
  pendingUploads: PendingUpload[]

  init: (boardId: number) => Promise<void>
  dispose: () => void
  refreshAssets: () => Promise<void>
  saveNow: (opts?: { keepalive?: boolean }) => Promise<void>
  uploadFiles: (
    files: File[],
    source: UploadSource,
    point: { x: number; y: number }
  ) => Promise<void>
  addLink: (url: string, point: { x: number; y: number }) => Promise<void>
  addTextNote: (text: string, point: { x: number; y: number }) => void
  updateNote: (assetId: string, note: string) => Promise<void>
  deleteAsset: (assetId: string) => Promise<void>
  centerOnAsset: (assetId: string) => void
}

// Silnik autosave i subskrypcja żyją poza store'em (nie są serializowalne
// i nie powinny wywoływać re-renderów).
let engine: AutosaveEngine<SceneDocument, Record<string, unknown>> | null = null
let unsubscribeScene: (() => void) | null = null
let lastDocument: SceneDocument | null = null
let lastCamera: Camera = DEFAULT_CAMERA
// Token kolejności init — unieważnia starsze (np. StrictMode podwójny mount).
let initSeq = 0

export const useBoardStore = create<BoardState>()((set, get) => ({
  boardId: null,
  initialized: false,
  version: 0,
  saveStatus: 'idle',
  assets: [],
  assetsLoading: false,
  pendingUploads: [],

  async init(boardId) {
    if (get().boardId === boardId && get().initialized) return
    get().dispose()

    const seq = ++initSeq
    set({
      boardId,
      initialized: false,
      version: 0,
      saveStatus: 'loading',
      assets: [],
      pendingUploads: [],
    })
    useSceneStore.getState().reset()

    try {
      const { version, document, appState } = await getScene(boardId)
      // Nowszy init/dispose wygrał — ten wczytuje nieaktualną tablicę.
      if (seq !== initSeq) return
      useSceneStore.getState().loadDocument(document)
      useSceneStore.getState().setCamera(cameraFromAppState(appState))

      lastDocument = document
      lastCamera = useSceneStore.getState().camera

      engine = new AutosaveEngine<SceneDocument, Record<string, unknown>>(
        {
          debounceMs: 1000,
          save: ({ version, document, appState }) =>
            putScene(boardId, { version, document, appState }),
          reload: async () => {
            const fresh = await getScene(boardId)
            return { version: fresh.version, document: fresh.document, appState: fresh.appState }
          },
          onStatus: (status) => set({ saveStatus: status }),
          onConflict: () => {
            toast.error(
              'Ta tablica była edytowana w innym oknie. Twoje zmiany zostały zachowane i ponownie zapisane.'
            )
          },
        },
        version
      )

      unsubscribeScene = useSceneStore.subscribe((state) => {
        if (state.document !== lastDocument || state.camera !== lastCamera) {
          lastDocument = state.document
          lastCamera = state.camera
          engine?.schedule(state.document, { camera: state.camera })
          set({ saveStatus: 'dirty' })
        }
      })

      set({ initialized: true, version, saveStatus: 'idle' })
      // Materiały usunięte z płótna w poprzedniej sesji nie mają już historii
      // cofania — sprzątamy je na serwerze, zanim pobierzemy listę.
      await pruneAssets(boardId).catch(() => [])
      await get().refreshAssets()
    } catch (error) {
      set({ saveStatus: 'error' })
      toast.error(error instanceof Error ? error.message : 'Nie udało się wczytać tablicy')
    }
  },

  dispose() {
    initSeq++
    unsubscribeScene?.()
    unsubscribeScene = null
    engine?.dispose()
    engine = null
    lastDocument = null
    lastCamera = DEFAULT_CAMERA
  },

  async refreshAssets() {
    const boardId = get().boardId
    if (boardId == null) return
    set({ assetsLoading: true })
    try {
      const assets = await listAssets(boardId)
      set({ assets })
    } catch {
      set({ assets: [] })
    } finally {
      set({ assetsLoading: false })
    }
  },

  async saveNow(opts) {
    const boardId = get().boardId
    if (boardId == null) return
    const { document, camera } = useSceneStore.getState()
    const version = engine?.currentVersion ?? get().version
    try {
      const next = await putScene(
        boardId,
        { version, document, appState: { camera } },
        { keepalive: opts?.keepalive ?? false }
      )
      engine?.setVersion(next)
      set({ version: next, saveStatus: 'saved' })
    } catch (error) {
      if (!(error instanceof AutosaveConflictError)) {
        set({ saveStatus: 'error' })
      }
    }
  },

  async uploadFiles(files, source, point) {
    const boardId = get().boardId
    if (boardId == null) return

    // Walidacja po stronie klienta — czytelny komunikat, bez cichej porażki.
    const valid: File[] = []
    for (const file of files) {
      const verdict = validateClientFile(file)
      if (verdict.ok) valid.push(file)
      else toast.error(fileRejectMessage(file.name, verdict.reason))
    }
    if (valid.length === 0) return

    // Optymistyczne placeholdery — od razu po wklejeniu/upuszczeniu.
    const placeholders = valid.map((file, i) =>
      createPendingUpload({
        id: createElementId(),
        source,
        filename: file.name,
        x: point.x + i * 24,
        y: point.y + i * 24,
      })
    )
    set({ pendingUploads: [...get().pendingUploads, ...placeholders] })

    try {
      const assets = await uploadFiles(boardId, valid, source, (fileIndex, e) => {
        const progress = e.total > 0 ? e.loaded / e.total : 0
        set((state) => ({
          pendingUploads: state.pendingUploads.map((u) =>
            u.id === placeholders[fileIndex].id ? { ...u, progress } : u
          ),
        }))
      })

      // Podmiana placeholderów na właściwe elementy sceny (w kolejności plików).
      // Kolejne obrazy układamy w rzędzie (bez nakładania), duże skalujemy do
      // MAX_IMAGE_EDGE — plik się nie zmienia, tylko jego rozmiar na płótnie.
      let cursorX = point.x
      for (const [i, asset] of assets.entries()) {
        const resolution = resolveUploadResult(get().pendingUploads, placeholders[i].id, {
          ok: true,
          asset: { id: String(asset.id), width: asset.width, height: asset.height },
          elementId: createElementId(),
        })
        set({ pendingUploads: resolution.pendingUploads })
        if (resolution.addedElement) {
          const el = resolution.addedElement
          const fit = Math.min(1, MAX_IMAGE_EDGE / Math.max(el.width, el.height, 1))
          const placed = {
            ...el,
            x: cursorX,
            y: point.y,
            width: Math.round(el.width * fit),
            height: Math.round(el.height * fit),
          }
          cursorX += placed.width + IMAGE_GAP
          useSceneStore.getState().addElement(placed)
        }
      }
      await get().refreshAssets()
    } catch (error) {
      // Rollback: usuń wszystkie placeholdery tej partii (brak sierot).
      const ids = new Set(placeholders.map((p) => p.id))
      set({ pendingUploads: get().pendingUploads.filter((u) => !ids.has(u.id)) })
      toast.error(error instanceof Error ? error.message : 'Upload nie powiódł się')
    }
  },

  async addLink(url, point) {
    const boardId = get().boardId
    if (boardId == null) return
    try {
      const asset = await createLinkAsset(boardId, url)
      const title = asset.linkMeta?.title?.trim()
      const label = title ? `${title}\n${url}` : url
      const el = createLinkSticky(label, point, String(asset.id))
      useSceneStore.getState().addElement(el)
      await get().refreshAssets()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nie udało się dodać linku')
    }
  },

  addTextNote(text, point) {
    useSceneStore.getState().addElement(createTextSticky(text, point))
  },

  async updateNote(assetId, note) {
    try {
      const updated = await apiUpdateNote(assetId, note)
      set({ assets: get().assets.map((a) => (String(a.id) === String(assetId) ? updated : a)) })
    } catch {
      toast.error('Nie udało się zapisać notatki')
    }
  },

  async deleteAsset(assetId) {
    try {
      await apiDeleteAsset(assetId)
      set({ assets: get().assets.filter((a) => String(a.id) !== String(assetId)) })

      // Usuń też elementy płótna wskazujące ten asset (bez sierot).
      const store = useSceneStore.getState()
      const ids = store.document.elements
        .filter((el) => elementAssetId(el) === String(assetId))
        .map((el) => el.id)
      if (ids.length > 0) store.deleteElements(ids)
    } catch {
      toast.error('Nie udało się usunąć assetu')
    }
  },

  centerOnAsset(assetId) {
    const store = useSceneStore.getState()
    const el = store.document.elements.find((e) => elementAssetId(e) === String(assetId))
    if (!el) {
      toast.error('Ten asset nie ma elementu na płótnie')
      return
    }
    store.selectOnly([el.id])
    const bounds = getElementBounds(el)
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    // Rzeczywisty rozmiar płótna (panel boczny ma różną szerokość wg zakładki).
    const root = document.querySelector('[data-testid="canvas-root"]')?.getBoundingClientRect()
    const vw = Math.max(1, root?.width ?? window.innerWidth - PANEL_WIDTH)
    const vh = Math.max(1, root?.height ?? window.innerHeight - CHROME_HEIGHT)
    store.setCamera({ x: vw / 2 - cx, y: vh / 2 - cy, scale: 1 })
  },
}))

/** Zwraca `assetId` elementu (dla image wymagane, dla sticky opcjonalne). */
function elementAssetId(el: SceneElement): string | null {
  // API zwraca id assetu jako liczbę, scena trzyma je jako tekst — porównujemy tekstowo.
  if (el.type === 'image') return String(el.assetId)
  if (el.type === 'sticky' && el.assetId) return String(el.assetId)
  return null
}

function cameraFromAppState(appState: Record<string, unknown> | null | undefined): Camera {
  const cam = (appState ?? {}).camera as { x?: unknown; y?: unknown; scale?: unknown } | undefined
  if (
    cam &&
    typeof cam.x === 'number' &&
    typeof cam.y === 'number' &&
    typeof cam.scale === 'number'
  ) {
    return { x: cam.x, y: cam.y, scale: cam.scale }
  }
  return DEFAULT_CAMERA
}

function createLinkSticky(
  text: string,
  point: { x: number; y: number },
  assetId: string
): SceneStickyElement {
  return {
    id: createElementId(),
    type: 'sticky',
    x: point.x,
    y: point.y,
    rotation: 0,
    opacity: 1,
    width: 280,
    height: 110,
    text,
    fill: DEFAULTS.linkCard,
    fontSize: 13,
    assetId,
  }
}

function createTextSticky(text: string, point: { x: number; y: number }): SceneStickyElement {
  return {
    id: createElementId(),
    type: 'sticky',
    x: point.x,
    y: point.y,
    rotation: 0,
    opacity: 1,
    width: 220,
    height: 120,
    text,
    fill: DEFAULTS.sticky,
    fontSize: 14,
  }
}

function fileRejectMessage(name: string, reason: ClientFileRejectReason): string {
  switch (reason) {
    case 'too_large':
      return `Plik „${name}” jest za duży (limit 20 MB)`
    case 'dangerous':
      return `Plik „${name}” ma niedozwolony typ`
    case 'unsupported':
      return `Nieobsługiwany typ pliku: ${name}`
  }
}

/**
 * Materiały widoczne w panelu: tylko te, które są na płótnie. Element usunięty
 * z płótna znika z listy od razu, a Ctrl+Z przywraca go razem z elementem.
 */
export function useCanvasAssets(): AssetDto[] {
  const assets = useBoardStore((s) => s.assets)
  const elements = useSceneStore((s) => s.document.elements)
  return useMemo(() => {
    const onCanvas = new Set(elements.map(elementAssetId).filter((id): id is string => id !== null))
    return assets.filter((a) => onCanvas.has(String(a.id)))
  }, [assets, elements])
}
