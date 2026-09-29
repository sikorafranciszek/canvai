import {
  ASSET_ROLES,
  InvalidModelOutputError,
  SECTION_KEYS,
  type AssetAnalysisData,
  type AssetRole,
  type ComposedSections,
  type PaletteColor,
  type TypographySample,
} from '#services/ai/types'

/**
 * Walidacja odpowiedzi modelu. Odpowiedź, która nie spełnia schematu, kończy
 * się `InvalidModelOutputError` (ponawialnym) — nie „naprawiamy” jej parsowaniem
 * stringów. Normalizujemy tylko to, co jednoznaczne (np. `#ABC` → `#aabbcc`,
 * przycięcie długości, brakujące tablice → []).
 */

const MAX_TEXT = 4000
const MAX_LIST = 30
const MAX_ITEM = 200

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => str(v, MAX_ITEM))
    .filter((v) => v.length > 0)
    .slice(0, MAX_LIST)
}

/** Normalizuje kolor do `#rrggbb` albo zwraca null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let hex = m[1].toLowerCase()
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  return `#${hex}`
}

function palette(value: unknown): PaletteColor[] {
  if (!Array.isArray(value)) return []
  const out: PaletteColor[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const hex = normalizeHex(isObject(item) ? item.hex : item)
    if (!hex || seen.has(hex)) continue
    seen.add(hex)
    const role = isObject(item) ? str(item.role, 60) : ''
    out.push(role ? { hex, role } : { hex })
    if (out.length >= 12) break
  }
  return out
}

function typography(value: unknown): TypographySample[] {
  if (!Array.isArray(value)) return []
  const out: TypographySample[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const usage = str(item.usage, 80)
    if (!usage) continue
    const sample: TypographySample = { usage }
    const family = str(item.family, 80)
    const size = str(item.size, 20)
    const weight = str(item.weight, 20)
    if (family) sample.family = family
    if (size) sample.size = size
    if (weight) sample.weight = weight
    out.push(sample)
    if (out.length >= 12) break
  }
  return out
}

/** Parsuje tekst odpowiedzi do obiektu JSON (tolerując ogrodzenie ```json). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const body = fenced ? fenced[1] : trimmed
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new InvalidModelOutputError('Model zwrócił odpowiedź, która nie jest poprawnym JSON-em')
  }
  if (!isObject(parsed)) {
    throw new InvalidModelOutputError('Model zwrócił JSON, który nie jest obiektem')
  }
  return parsed
}

/** Waliduje wynik etapu 1. */
export function validateAssetAnalysis(value: unknown): AssetAnalysisData {
  if (!isObject(value)) throw new InvalidModelOutputError('Analiza assetu: oczekiwano obiektu')

  const summary = str(value.summary, 1500)
  if (!summary) throw new InvalidModelOutputError('Analiza assetu: brak pola „summary”')

  const rawRole = str(value.role, 40).toLowerCase()
  const role: AssetRole = (ASSET_ROLES as readonly string[]).includes(rawRole)
    ? (rawRole as AssetRole)
    : 'other'

  return {
    role,
    summary,
    ocrText: str(value.ocrText, MAX_TEXT),
    palette: palette(value.palette),
    typography: typography(value.typography),
    components: strList(value.components),
    layoutPatterns: strList(value.layoutPatterns),
    tags: strList(value.tags).slice(0, 12),
  }
}

/** Waliduje wynik etapu 2: siedem niepustych sekcji markdown. */
export function validateComposedSections(value: unknown): ComposedSections {
  if (!isObject(value)) throw new InvalidModelOutputError('Dokument: oczekiwano obiektu')
  const sections = isObject(value.sections) ? value.sections : value

  const out = {} as ComposedSections
  const missing: string[] = []
  for (const key of SECTION_KEYS) {
    const body = str(sections[key], 20_000)
    if (!body) missing.push(key)
    out[key] = body
  }
  if (missing.length > 0) {
    throw new InvalidModelOutputError(`Dokument: puste lub brakujące sekcje: ${missing.join(', ')}`)
  }
  return out
}
