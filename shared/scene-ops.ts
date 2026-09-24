/**
 * Czyste operacje na `SceneDocument` — reducer sceny (bez Reacta/Konvy).
 *
 * Współdzielone przez serwer (testy unit) i klienta (store). Wszystkie funkcje
 * są niezmienne: zwracają nowy dokument, nie mutują wejścia. Dzięki temu
 * `JSON.parse(JSON.stringify(doc))` zawsze daje identyczną scenę po ponownym
 * renderze (wymóg kontraktu).
 */
import type { SceneDocument, SceneElement } from './scene.js'

/** Limit historii — chroni pamięć przy długiej sesji (500+ elementów). */
export const HISTORY_LIMIT = 100

/** Stabilny identyfikator elementu (UUID v4). */
export function createElementId(): string {
  return globalThis.crypto.randomUUID()
}

/** Dodaje element na wierzch (koniec tablicy = wierzch). */
export function addElement(doc: SceneDocument, element: SceneElement): SceneDocument {
  return { ...doc, elements: [...doc.elements, element] }
}

/** Aktualizuje pola elementu o podanym id (merge). */
export function updateElement(
  doc: SceneDocument,
  id: string,
  patch: Partial<SceneElement>
): SceneDocument {
  return {
    ...doc,
    elements: doc.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as SceneElement) : el)),
  }
}

/** Usuwa elementy o podanych id. */
export function removeElements(doc: SceneDocument, ids: string[]): SceneDocument {
  const set = new Set(ids)
  return { ...doc, elements: doc.elements.filter((el) => !set.has(el.id)) }
}

/** Przesuwa elementy o wektor (dx, dy). */
export function moveElements(doc: SceneDocument, ids: string[], dx: number, dy: number): SceneDocument {
  const set = new Set(ids)
  return {
    ...doc,
    elements: doc.elements.map((el) =>
      set.has(el.id) ? ({ ...el, x: el.x + dx, y: el.y + dy } as SceneElement) : el
    ),
  }
}

/** Duplikuje elementy (nowe id, offset +10 px). */
export function duplicateElements(doc: SceneDocument, ids: string[]): SceneDocument {
  const set = new Set(ids)
  const clones = doc.elements
    .filter((el) => set.has(el.id))
    .map((el) => ({ ...el, id: createElementId(), x: el.x + 10, y: el.y + 10 }) as SceneElement)
  return { ...doc, elements: [...doc.elements, ...clones] }
}

/**
 * Zmienia kolejność warstwy elementu.
 * `direction: 'forward'` = o jedną warstwę w górę (późniejszy indeks = wierzch).
 * `direction: 'backward'` = o jedną warstwę w dół.
 */
export function reorderElement(
  doc: SceneDocument,
  id: string,
  direction: 'forward' | 'backward'
): SceneDocument {
  const index = doc.elements.findIndex((el) => el.id === id)
  if (index === -1) return doc

  const target = direction === 'forward' ? index + 1 : index - 1
  if (target < 0 || target >= doc.elements.length) return doc

  const elements = [...doc.elements]
  const [el] = elements.splice(index, 1)
  elements.splice(target, 0, el)
  return { ...doc, elements }
}

/** Stan historii undo/redo. */
export interface SceneHistoryState {
  document: SceneDocument
  past: SceneDocument[]
  future: SceneDocument[]
}

/** Zatwierdza nowy stan jako kolejny krok historii (czyści future). */
export function commitHistory(state: SceneHistoryState, next: SceneDocument): SceneHistoryState {
  const past = [...state.past, state.document]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { document: next, past, future: [] }
}

/** Cofa o jeden krok. Zwraca niezmieniony stan, gdy nie ma czego cofnąć. */
export function undoHistory(state: SceneHistoryState): SceneHistoryState {
  const past = [...state.past]
  const previous = past.pop()
  if (!previous) return state
  return { document: previous, past, future: [state.document, ...state.future] }
}

/** Ponawia o jeden krok. */
export function redoHistory(state: SceneHistoryState): SceneHistoryState {
  const [next, ...rest] = state.future
  if (!next) return state
  return { document: next, past: [...state.past, state.document], future: rest }
}
