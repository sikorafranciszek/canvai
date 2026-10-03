/**
 * Jak materiał ma być użyty przy generowaniu DESIGN.md — wspólne dla serwera
 * (prompt, ugruntowanie, render) i klienta (panel materiałów).
 *
 * - rola `own`         — materiał produktu/marki: źródło prawdy,
 * - rola `inspiration` — referencja: bierzemy tylko wskazane aspekty,
 * - rola `avoid`       — anty-wzór: trafia wyłącznie do „Don't”,
 * - brak roli          — AI ocenia samo (jak dotąd).
 *
 * Aspekty zawężają, co wolno wziąć z materiału. Pusta lista = wszystko.
 */

export const ASSET_ROLES = ['own', 'inspiration', 'avoid'] as const
export type AssetRole = (typeof ASSET_ROLES)[number]

export const ASSET_ASPECTS = [
  'colors',
  'typography',
  'layout',
  'components',
  'imagery',
  'copy',
] as const
export type AssetAspect = (typeof ASSET_ASPECTS)[number]

export interface AssetUsage {
  role: AssetRole | null
  aspects: AssetAspect[]
}

export const DEFAULT_USAGE: AssetUsage = { role: null, aspects: [] }

/** Normalizacja danych z bazy / API (nieznane wartości odrzucane). */
export function normalizeUsage(role: unknown, aspects: unknown): AssetUsage {
  return {
    role: ASSET_ROLES.includes(role as AssetRole) ? (role as AssetRole) : null,
    aspects: Array.isArray(aspects) ? ASSET_ASPECTS.filter((a) => aspects.includes(a)) : [],
  }
}

/** Czy z materiału wolno wziąć dany aspekt do tokenów / komponentów. */
export function allowsAspect(usage: AssetUsage | null | undefined, aspect: AssetAspect): boolean {
  if (!usage) return true
  if (usage.role === 'avoid') return false
  return usage.aspects.length === 0 || usage.aspects.includes(aspect)
}

export function isDefaultUsage(usage: AssetUsage | null | undefined): boolean {
  return !usage || (usage.role === null && usage.aspects.length === 0)
}

const ASPECT_EN: Record<AssetAspect, string> = {
  colors: 'colors',
  typography: 'typography',
  layout: 'layout',
  components: 'components',
  imagery: 'imagery & icons',
  copy: 'copy & tone',
}

/** Krótki opis po angielsku (DESIGN.md jest po angielsku). */
export function describeUsage(usage: AssetUsage | null | undefined): string {
  if (!usage || isDefaultUsage(usage)) return 'all aspects'
  if (usage.role === 'avoid') return 'anti-pattern — avoid'
  const what = usage.aspects.length
    ? usage.aspects.map((a) => ASPECT_EN[a]).join(', ')
    : 'all aspects'
  return usage.role === 'own'
    ? `own product — ${what}`
    : usage.role === 'inspiration'
      ? `inspiration — ${what} only`
      : `${what} only`
}

/** Instrukcja dla AI budującego UI: co wziąć z referencji, a co pominąć. */
export function usageGuideLine(usage: AssetUsage): string | null {
  if (isDefaultUsage(usage)) return null
  if (usage.role === 'avoid') {
    return 'anti-pattern: do NOT copy its look; it explains what to avoid.'
  }
  const ignored = ASSET_ASPECTS.filter((a) => !allowsAspect(usage, a))
  const take = usage.aspects.length
    ? usage.aspects.map((a) => ASPECT_EN[a]).join(', ')
    : 'everything'
  const role =
    usage.role === 'own'
      ? 'own product / brand'
      : usage.role === 'inspiration'
        ? 'inspiration'
        : 'reference'
  return `${role}: take ${take}${ignored.length ? `; ignore its ${ignored.map((a) => ASPECT_EN[a]).join(', ')}` : ''}.`
}
