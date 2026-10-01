/**
 * Scalanie scen przy współpracy na żywo (trójstronne, na poziomie elementów).
 *
 * - `base`   — ostatnia wersja, którą ten klient zsynchronizował z serwerem,
 * - `local`  — bieżący stan w przeglądarce (base + lokalne zmiany),
 * - `remote` — świeży stan serwera (base + zmiany innych osób).
 *
 * Wynik = remote + lokalne zmiany (dodane, zmienione, usunięte elementy).
 * Ta sama zmiana elementu po obu stronach: wygrywa lokalna (użytkownik widzi
 * to, co właśnie zrobił). Element usunięty zdalnie, a lokalnie zmieniony,
 * wraca (zmiana nie znika bez śladu). Kolejność: jak w remote, nowe lokalne
 * elementy na końcu w lokalnej kolejności. Czysty moduł — testy w
 * `tests/unit/scene_merge.spec.ts`.
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
  return { upserts, deletes, metadata: !same(base.metadata, local.metadata) }
}

export function hasLocalChanges(base: SceneDocument, local: SceneDocument): boolean {
  const c = localChanges(base, local)
  return c.upserts.size > 0 || c.deletes.size > 0 || c.metadata
}

export function mergeScenes(
  base: SceneDocument,
  local: SceneDocument,
  remote: SceneDocument
): SceneDocument {
  const changes = localChanges(base, local)
  if (!changes.upserts.size && !changes.deletes.size && !changes.metadata) return remote

  const elements: SceneElement[] = []
  const placed = new Set<string>()
  for (const el of remote.elements) {
    if (changes.deletes.has(el.id)) continue
    elements.push(changes.upserts.get(el.id) ?? el)
    placed.add(el.id)
  }
  for (const el of local.elements) {
    if (placed.has(el.id) || !changes.upserts.has(el.id)) continue
    elements.push(el)
    placed.add(el.id)
  }

  return {
    ...remote,
    elements,
    metadata: changes.metadata ? { ...remote.metadata, ...local.metadata } : remote.metadata,
  }
}
