/**
 * Scalanie scen przy współpracy na żywo — trójstronne, PER WŁAŚCIWOŚĆ (DAT-7).
 *
 * - `base`   — ostatnia wersja, którą ten klient zsynchronizował z serwerem,
 * - `local`  — bieżący stan w przeglądarce (base + lokalne zmiany),
 * - `remote` — świeży stan serwera (base + zmiany innych osób).
 *
 * Zasady:
 * - zmiany różnych właściwości tego samego elementu łączą się (ja przesuwam,
 *   ktoś zmienia kolor → oba efekty); ta sama właściwość po obu stronach —
 *   wygrywa lokalna (użytkownik widzi to, co właśnie zrobił);
 * - usunięcie kontra edycja: zmiana NIE znika bez śladu — element zostaje
 *   (w obie strony: lokalnie usunięty, a zdalnie zmieniony, i odwrotnie);
 * - kolejność warstw: lokalna zmiana kolejności jest zachowana, nowe zdalne
 *   elementy wchodzą za swojego poprzednika ze zdalnej kolejności; bez lokalnej
 *   zmiany kolejności — jak w remote, nowe lokalne elementy na końcu.
 *
 * Czysty moduł — testy w `tests/unit/scene_merge.spec.ts`.
 */
import type { SceneDocument, SceneElement } from './scene.js'

function byId(elements: SceneElement[]): Map<string, SceneElement> {
  return new Map(elements.map((e) => [e.id, e]))
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export interface LocalChanges {
  upserts: Map<string, SceneElement>
  deletes: Set<string>
  metadata: boolean
  /** Czy lokalnie zmieniła się kolejność elementów obecnych w bazie. */
  reordered: boolean
}

function order(elements: SceneElement[], keep: Set<string>): string[] {
  return elements.map((e) => e.id).filter((id) => keep.has(id))
}

/** Lokalne zmiany względem bazy. */
export function localChanges(base: SceneDocument, local: SceneDocument): LocalChanges {
  const baseMap = byId(base.elements)
  const localMap = byId(local.elements)
  const upserts = new Map<string, SceneElement>()
  const deletes = new Set<string>()
  for (const [id, el] of localMap) {
    const before = baseMap.get(id)
    if (!before || !same(before, el)) upserts.set(id, el)
  }
  for (const id of baseMap.keys()) if (!localMap.has(id)) deletes.add(id)
  const common = new Set([...baseMap.keys()].filter((id) => localMap.has(id)))
  const reordered = !same(order(base.elements, common), order(local.elements, common))
  return { upserts, deletes, metadata: !same(base.metadata, local.metadata), reordered }
}

export function hasLocalChanges(base: SceneDocument, local: SceneDocument): boolean {
  const c = localChanges(base, local)
  return c.upserts.size > 0 || c.deletes.size > 0 || c.metadata || c.reordered
}

/** Scalenie jednego elementu zmienionego po obu stronach: per właściwość. */
export function mergeElement(
  base: SceneElement,
  local: SceneElement,
  remote: SceneElement
): SceneElement {
  // Zmiana typu (rzadkie) — nie da się łączyć pól; wygrywa lokalna wersja.
  if (local.type !== remote.type) return local
  const out: Record<string, unknown> = { ...remote }
  const b = base as unknown as Record<string, unknown>
  const l = local as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(b), ...Object.keys(l)])) {
    if (!same(b[key], l[key])) {
      if (l[key] === undefined) delete out[key]
      else out[key] = l[key]
    }
  }
  return out as unknown as SceneElement
}

export function mergeScenes(
  base: SceneDocument,
  local: SceneDocument,
  remote: SceneDocument
): SceneDocument {
  const changes = localChanges(base, local)
  if (!changes.upserts.size && !changes.deletes.size && !changes.metadata && !changes.reordered) {
    return remote
  }

  const baseMap = byId(base.elements)
  const remoteMap = byId(remote.elements)
  const localMap = byId(local.elements)

  const resolve = (id: string): SceneElement | null => {
    const r = remoteMap.get(id)
    const l = localMap.get(id)
    const b = baseMap.get(id)
    if (changes.deletes.has(id)) {
      // Lokalnie usunięty, a zdalnie zmieniony — zdalna praca nie znika.
      return r && b && !same(r, b) ? r : null
    }
    if (!r) {
      // Zdalnie usunięty: wraca tylko, gdy lokalnie go zmieniono (albo jest nowy).
      return l && changes.upserts.has(id) ? l : null
    }
    if (!l || !changes.upserts.has(id)) return r
    if (!b || same(r, b)) return l
    return mergeElement(b, l, r)
  }

  let ids: string[]
  if (!changes.reordered) {
    ids = remote.elements.map((e) => e.id)
    for (const el of local.elements) if (!remoteMap.has(el.id)) ids.push(el.id)
  } else {
    // Lokalna kolejność + nowe zdalne elementy za swoim zdalnym poprzednikiem.
    ids = local.elements.map((e) => e.id)
    const present = new Set(ids)
    remote.elements.forEach((el, i) => {
      if (present.has(el.id)) return
      const prev = i > 0 ? remote.elements[i - 1].id : null
      const at = prev ? ids.indexOf(prev) : -1
      ids.splice(at + 1, 0, el.id)
      present.add(el.id)
    })
  }

  const elements: SceneElement[] = []
  const placed = new Set<string>()
  for (const id of ids) {
    if (placed.has(id)) continue
    placed.add(id)
    const el = resolve(id)
    if (el) elements.push(el)
  }

  return {
    ...remote,
    elements,
    metadata: changes.metadata ? { ...remote.metadata, ...local.metadata } : remote.metadata,
  }
}
