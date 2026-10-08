import type { DesignDocSource } from '#models/design_doc'
import type { DesignSpec } from '#services/design/spec'
import { isDefaultUsage, type AssetUsage } from '#shared/asset-usage'

/**
 * Zmiany między wersjami DESIGN.md opisane po ludzku (FEAT-1): tokeny „było →
 * jest” (kolory z próbkami, fonty, promienie, odstępy), komponenty i ekrany
 * dodane/usunięte oraz PRZYCZYNY z danych tablicy (nowe/usunięte materiały,
 * zmiana roli, ręczna edycja, tryb Pro, nowa wersja promptu). Bez AI — wynik
 * jest deterministyczny i tani; UI tłumaczy przyczyny na język użytkownika.
 */

export interface ValueChange {
  name: string
  from: string
  to: string
}

export interface NamedValue {
  name: string
  value: string
}

export interface ChangeGroup {
  added: NamedValue[]
  removed: NamedValue[]
  changed: ValueChange[]
}

export type ChangeReason =
  | { type: 'asset_added'; assetId: number; filename: string; usage?: AssetUsage }
  | { type: 'asset_removed'; assetId: number; filename: string }
  | { type: 'usage_changed'; assetId: number; filename: string; from?: AssetUsage; to?: AssetUsage }
  | { type: 'edited' }
  | { type: 'pro_mode'; on: boolean }
  | { type: 'prompt_version'; from: string; to: string }

export interface SpecChanges {
  colors: ChangeGroup
  fonts: ChangeGroup
  radii: ChangeGroup
  spacing: ChangeGroup
  components: { added: string[]; removed: string[] }
  screens: { added: string[]; removed: string[] }
  reasons: ChangeReason[]
  /** Czy w ogóle coś się zmieniło w tokenach / strukturze. */
  empty: boolean
}

export interface DocSnapshot {
  version: number
  spec: DesignSpec | null
  sources: DesignDocSource[] | null
  promptVersion: string | null
  proMode: boolean
  editedFromVersion: number | null
}

function group(
  before: { key: string; name: string; value: string }[],
  after: { key: string; name: string; value: string }[]
): ChangeGroup {
  const prev = new Map(before.map((x) => [x.key, x]))
  const next = new Map(after.map((x) => [x.key, x]))
  const out: ChangeGroup = { added: [], removed: [], changed: [] }
  for (const [key, x] of next) {
    const old = prev.get(key)
    if (!old) out.added.push({ name: x.name, value: x.value })
    else if (old.value.toLowerCase() !== x.value.toLowerCase()) {
      out.changed.push({ name: x.name, from: old.value, to: x.value })
    }
  }
  for (const [key, x] of prev)
    if (!next.has(key)) out.removed.push({ name: x.name, value: x.value })
  return out
}

const norm = (s: string) => s.trim().toLowerCase()

function listDiff(before: string[], after: string[]) {
  const prev = new Set(before.map(norm))
  const next = new Set(after.map(norm))
  return {
    added: after.filter((x) => !prev.has(norm(x))),
    removed: before.filter((x) => !next.has(norm(x))),
  }
}

const sameUsage = (a?: AssetUsage, b?: AssetUsage) =>
  (isDefaultUsage(a) && isDefaultUsage(b)) ||
  (a?.role === b?.role &&
    [...(a?.aspects ?? [])].sort().join() === [...(b?.aspects ?? [])].sort().join())

/** Poprzednia gotowa wersja tablicy (do porównania), albo `null`. */
export async function previousReady(boardId: number, version: number) {
  const { default: DesignDoc } = await import('#models/design_doc')
  return DesignDoc.query()
    .where('board_id', boardId)
    .where('status', 'ready')
    .where('version', '<', version)
    .orderBy('version', 'desc')
    .first()
}

export function diffDocs(from: DocSnapshot, to: DocSnapshot): SpecChanges {
  const a = from.spec
  const b = to.spec
  const empty: ChangeGroup = { added: [], removed: [], changed: [] }
  const colors =
    a && b
      ? group(
          a.colors.map((c) => ({ key: c.token, name: c.name, value: c.hex })),
          b.colors.map((c) => ({ key: c.token, name: c.name, value: c.hex }))
        )
      : empty
  const fonts =
    a && b
      ? group(
          a.typography.families.map((f) => ({ key: f.token, name: f.token, value: f.name })),
          b.typography.families.map((f) => ({ key: f.token, name: f.token, value: f.name }))
        )
      : empty
  const radii =
    a && b
      ? group(
          a.radii.map((r) => ({ key: norm(r.name), name: r.name, value: r.value })),
          b.radii.map((r) => ({ key: norm(r.name), name: r.name, value: r.value }))
        )
      : empty
  const spacing =
    a && b
      ? group(
          a.spacing.scale.map((s) => ({ key: norm(s.name), name: s.name, value: s.value })),
          b.spacing.scale.map((s) => ({ key: norm(s.name), name: s.name, value: s.value }))
        )
      : empty
  const components =
    a && b
      ? listDiff(
          a.components.map((c) => c.name),
          b.components.map((c) => c.name)
        )
      : { added: [], removed: [] }
  const screens =
    a && b
      ? listDiff(
          a.screens.map((s) => s.name),
          b.screens.map((s) => s.name)
        )
      : { added: [], removed: [] }

  // Przyczyny z danych tablicy.
  const reasons: ChangeReason[] = []
  if (to.editedFromVersion) reasons.push({ type: 'edited' })
  const prevSources = new Map((from.sources ?? []).map((s) => [s.assetId, s]))
  const nextSources = new Map((to.sources ?? []).map((s) => [s.assetId, s]))
  for (const [id, s] of nextSources) {
    const old = prevSources.get(id)
    if (!old)
      reasons.push({ type: 'asset_added', assetId: id, filename: s.filename, usage: s.usage })
    else if (!sameUsage(old.usage, s.usage)) {
      reasons.push({
        type: 'usage_changed',
        assetId: id,
        filename: s.filename,
        from: old.usage,
        to: s.usage,
      })
    }
  }
  for (const [id, s] of prevSources) {
    if (!nextSources.has(id))
      reasons.push({ type: 'asset_removed', assetId: id, filename: s.filename })
  }
  if (from.proMode !== to.proMode) reasons.push({ type: 'pro_mode', on: to.proMode })
  if (from.promptVersion && to.promptVersion && from.promptVersion !== to.promptVersion) {
    reasons.push({ type: 'prompt_version', from: from.promptVersion, to: to.promptVersion })
  }

  const count = (g: ChangeGroup) => g.added.length + g.removed.length + g.changed.length
  return {
    colors,
    fonts,
    radii,
    spacing,
    components,
    screens,
    reasons,
    empty:
      count(colors) +
        count(fonts) +
        count(radii) +
        count(spacing) +
        components.added.length +
        components.removed.length +
        screens.added.length +
        screens.removed.length ===
      0,
  }
}
