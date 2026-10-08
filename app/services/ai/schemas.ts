import {
  ASSET_ROLES,
  InvalidModelOutputError,
  type AssetAnalysisData,
  type AssetRole,
  type PaletteColor,
  type TextColor,
  type TypographySample,
} from '#services/ai/types'
import { t } from '#services/i18n'

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
    const category = str(item.category, 60)
    const lineHeight = str(item.lineHeight, 20)
    const evidence = str(item.evidence, 20).toLowerCase()
    if (family) sample.family = family
    if (category) sample.category = category
    // Bez jawnego „named” nazwa kroju jest przypuszczeniem.
    if (family || category) sample.evidence = evidence === 'named' && family ? 'named' : 'inferred'
    if (size) sample.size = size
    if (weight) sample.weight = weight
    if (lineHeight) sample.lineHeight = lineHeight
    out.push(sample)
    if (out.length >= 12) break
  }
  return out
}

function textColors(value: unknown): TextColor[] {
  if (!Array.isArray(value)) return []
  const out: TextColor[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const hex = normalizeHex(item.hex)
    const usage = str(item.usage, 80)
    if (!hex || !usage) continue
    out.push({ hex, usage })
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
    throw new InvalidModelOutputError(t('ai.invalidJson'))
  }
  if (!isObject(parsed)) {
    throw new InvalidModelOutputError(t('ai.jsonNotObject'))
  }
  return parsed
}

/** Waliduje wynik etapu 1. */
export function validateAssetAnalysis(value: unknown): AssetAnalysisData {
  if (!isObject(value)) throw new InvalidModelOutputError(t('ai.analysisNotObject'))

  const summary = str(value.summary, 1500)
  if (!summary) throw new InvalidModelOutputError(t('ai.analysisNoSummary'))

  const rawRole = str(value.role, 40).toLowerCase()
  const role: AssetRole = (ASSET_ROLES as readonly string[]).includes(rawRole)
    ? (rawRole as AssetRole)
    : 'other'

  return {
    role,
    summary,
    ocrText: str(value.ocrText, MAX_TEXT),
    palette: palette(value.palette),
    textColors: textColors(value.textColors),
    typography: typography(value.typography),
    components: strList(value.components),
    layoutPatterns: strList(value.layoutPatterns),
    styleHints: strList(value.styleHints),
    mood: str(value.mood, 200),
    tags: strList(value.tags).slice(0, 12),
  }
}
