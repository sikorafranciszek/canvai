import { InvalidModelOutputError } from '#services/ai/types'
import { normalizeHex } from '#services/ai/schemas'
import { t } from '#services/i18n'
import { colorDistance, hexToOklab } from '#shared/color'
import { allowsAspect, type AssetUsage } from '#shared/asset-usage'

/**
 * `DesignSpec` — ustrukturyzowany wynik etapu 2 (kompozycji).
 *
 * Model zwraca dane, a nie markdown. Dokument DESIGN.md (format „Style
 * Reference”: tokeny, typografia, komponenty, Do/Don't, Quick Start CSS/Tailwind)
 * składa kod w `renderer.ts` — dzięki temu tabele tokenów, `:root` i `@theme`
 * zawsze są ze sobą spójne, a każda pozycja ma źródło albo jawną flagę założenia.
 *
 * `sources` = identyfikatory assetów tablicy (liczby). `assumed: true` = wartość
 * nie wynika z materiałów (np. domyślna skala odstępów) — renderer ją oznacza.
 */

export interface SpecColor {
  name: string
  hex: string
  token: string
  role: string
  sources: number[]
  assumed: boolean
  /** Wartość potwierdzona albo poprawiona przez użytkownika w edytorze tokenów. */
  confirmed?: boolean
}

export interface SpecFontFamily {
  name: string
  token: string
  substitute: string
  weights: number[]
  sizes: string[]
  lineHeights: string[]
  role: string
  sources: number[]
  assumed: boolean
  confirmed?: boolean
}

export interface SpecTypeScaleRow {
  role: string
  family: string
  weight: string
  size: string
  lineHeight: string
  letterSpacing: string
  token: string
}

export interface SpecNameValue {
  name: string
  value: string
}

export interface SpecComponent {
  name: string
  role: string
  description: string
  states: string[]
  sources: number[]
  assumed: boolean
}

export interface SpecScreen {
  name: string
  purpose: string
  elements: string[]
  sources: number[]
}

export interface SpecSurface {
  level: number
  name: string
  value: string
  purpose: string
}

export interface DesignSpec {
  name: string
  tagline: string
  theme: 'light' | 'dark' | 'mixed'
  overview: string
  colors: SpecColor[]
  typography: {
    families: SpecFontFamily[]
    scale: SpecTypeScaleRow[]
  }
  spacing: {
    baseUnit: string
    density: string
    scale: SpecNameValue[]
    assumed: boolean
  }
  radii: SpecNameValue[]
  shadows: SpecNameValue[]
  layout: {
    pageMaxWidth: string
    sectionGap: string
    cardPadding: string
    elementGap: string
    description: string
  }
  components: SpecComponent[]
  screens: SpecScreen[]
  flows: string[]
  voice: { tone: string; examples: string[] }
  dos: string[]
  donts: string[]
  surfaces: SpecSurface[]
  elevation: string
  imagery: string
  agentGuide: {
    quickColors: SpecNameValue[]
    componentPrompts: string[]
  }
  similarBrands: { name: string; reason: string }[]
  openQuestions: string[]
  /*
   * System (AI-9). Opcjonalne — specyfikacje zapisane przed v6 ich nie mają.
   * Wartości z materiałów albo domyślne (wtedy nazwa grupy w `systemAssumed`).
   */
  breakpoints?: SpecNameValue[]
  zIndex?: SpecNameValue[]
  motion?: SpecNameValue[]
  borders?: SpecNameValue[]
  focusRing?: string
  iconography?: string
  systemAssumed?: string[]
}

// ---------------------------------------------------------------------------
// Walidacja / normalizacja
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 2000): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function list<T>(value: unknown, map: (item: unknown) => T | null, max = 40): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const item of value) {
    const mapped = map(item)
    if (mapped !== null) out.push(mapped)
    if (out.length >= max) break
  }
  return out
}

function strList(value: unknown, max = 30, itemMax = 400): string[] {
  return list(value, (v) => str(v, itemMax) || null, max)
}

/** Identyfikatory assetów: liczby, "12", "A12", "[A12]". */
function ids(value: unknown): number[] {
  const out = new Set<number>()
  for (const item of Array.isArray(value) ? value : [value]) {
    const m = String(item ?? '').match(/(\d+)/)
    if (m) out.add(Number(m[1]))
  }
  return [...out].filter((n) => Number.isFinite(n) && n > 0)
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** `--color-warm-ink`; akceptuje `color-warm-ink`, `warm ink` itp. */
function token(value: unknown, prefix: string, fallbackName: string): string {
  const raw = str(value, 80).replace(/^--/, '')
  const base = slug(raw || `${prefix}-${fallbackName}`)
  return `--${base.startsWith(`${prefix}-`) || base === prefix ? base : `${prefix}-${base}`}`
}

function nameValue(item: unknown, nameKey = 'name', valueKey = 'value'): SpecNameValue | null {
  if (!isObject(item)) return null
  const name = str(item[nameKey] ?? item.element ?? item.label, 80)
  const value = str(item[valueKey], 200)
  return name && value ? { name, value } : null
}

// ---------------------------------------------------------------------------
// Wartości CSS
// ---------------------------------------------------------------------------

const LENGTH = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|ch|ex)?`
const LENGTHS = new RegExp(`^${LENGTH}(?:\\s+${LENGTH}){0,3}$`)

/** Usuwa komentarze w nawiasach — „50% (24px circle)” → „50%”; funkcje CSS (`rgba(…)`) zostają. */
function stripNotes(value: string): string {
  let prev = ''
  let out = value
  while (out !== prev) {
    prev = out
    out = out.replace(/(^|[^a-z0-9-])\([^()]*\)/gi, '$1')
  }
  return out
    .replace(/^[~≈]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Wartość długości gotowa do wklejenia w CSS albo `null`, gdy model zwrócił opis
 * zamiast wartości. `unitless` — dopuszcza liczby bez jednostki (line-height).
 */
export function cssLength(raw: string, { unitless = false } = {}): string | null {
  const value = stripNotes(raw)
  if (!value) return null
  if (/^(0|auto|normal|none)$/i.test(value)) return value.toLowerCase()
  if (LENGTHS.test(value)) {
    // „8” → „8px” (poza line-height, gdzie liczba bez jednostki jest poprawna).
    return unitless ? value : value.replace(/(^|\s)(-?(?:\d+\.?\d*|\.\d+))(?=\s|$)/g, '$1$2px')
  }
  if (/\b(pill|full|fully rounded|capsule)\b/i.test(value)) return '9999px'
  if (/\b(circle|circular|round)\b/i.test(value)) return '50%'
  const lead = value.match(/^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|ch|ex)(?![\w.])/)
  if (lead) return lead[0]
  return null
}

const SHADOW_WORDS = new Set([
  'inset',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'oklch',
  'oklab',
  'transparent',
  'black',
  'white',
  'currentcolor',
  'px',
  'rem',
  'em',
])

/** Cień jako poprawny `box-shadow` (bez opisów słownych) albo `null`. */
export function cssShadow(raw: string): string | null {
  const value = stripNotes(raw)
  if (/^none$/i.test(value)) return 'none'
  if (!/\d/.test(value) || /[^\w\s#().,%/-]/.test(value)) return null
  const words = value.replace(/#[0-9a-f]{3,8}\b/gi, '').match(/[a-z]+/gi) ?? []
  return words.every((w) => SHADOW_WORDS.has(w.toLowerCase())) ? value : null
}

const MOTION_DURATION = /^\d+(?:\.\d+)?m?s$/i
const MOTION_EASING =
  /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\))$/i
const FOCUS_RING =
  /^\d+(?:\.\d+)?px\s+(?:solid|dashed|dotted|double)\s+(?:#[0-9a-f]{3,8}|rgba?\([^()]*\)|var\(--[a-z0-9-]+\))$/i

/** Czas (`150ms`) albo krzywa (`ease-out`, `cubic-bezier(…)`) — inaczej `null`. */
export function cssMotion(raw: string): string | null {
  const value = stripNotes(raw)
  return MOTION_DURATION.test(value) || MOTION_EASING.test(value) ? value : null
}

/** Wartość w px (do sortowania skali odstępów); `rem` = 16px. */
function toPx(value: string): number {
  const m = value.match(/^(-?[\d.]+)(px|rem|em)?$/)
  if (!m) return Number.NaN
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1)
}

const SIZE_LADDER = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']

/**
 * Spójne nazwy tokenów (AI-9):
 * - odstępy o nazwach liczbowych („8”) dostają nazwy semantyczne (xs…2xl) —
 *   `--spacing-8: 8px` w Tailwind v4 zmieniałby znaczenie `p-8` (2rem → 8px);
 * - duplikaty nazw w każdej rodzinie tokenów są usuwane (pierwszy wygrywa),
 *   a powtórzone tokeny fontów i skali dostają sufiks.
 */
export function normalizeTokenNames(spec: DesignSpec): void {
  const scale = spec.spacing.scale
  if (scale.length && scale.every((s) => /^\d+(?:\.\d+)?(?:px|rem)?$/i.test(s.name.trim()))) {
    const sorted = [...scale].sort((a, b) => toPx(a.value) - toPx(b.value))
    const md = sorted.reduce(
      (best, s, i) =>
        Math.abs(toPx(s.value) - 16) < Math.abs(toPx(sorted[best].value) - 16) ? i : best,
      0
    )
    const start = Math.max(0, SIZE_LADDER.indexOf('md') - md)
    spec.spacing.scale = sorted.map((s, i) => ({
      name: SIZE_LADDER[start + i] ?? `${start + i - SIZE_LADDER.length + 7}xl`,
      value: s.value,
    }))
  }
  const uniqueNames = (items: SpecNameValue[]) => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const key = slug(item.name)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  spec.spacing.scale = uniqueNames(spec.spacing.scale)
  spec.radii = uniqueNames(spec.radii)
  spec.shadows = uniqueNames(spec.shadows)
  for (const key of ['breakpoints', 'zIndex', 'motion', 'borders'] as const) {
    if (spec[key]) spec[key] = uniqueNames(spec[key]!)
  }
  const suffix = <T extends { token: string }>(items: T[]) => {
    const seen = new Set<string>()
    for (const item of items) {
      let t = item.token
      for (let i = 2; seen.has(t); i++) t = `${item.token}-${i}`
      item.token = t
      seen.add(t)
    }
  }
  suffix(spec.typography.families)
  suffix(spec.typography.scale)
}

/**
 * Dokument dla narzędzi do kodu musi mieć breakpointy, warstwy, ruch, obramowania
 * i focus. Czego nie widać w materiałach, kod uzupełnia typowymi wartościami jako
 * założenia — z pytaniem w Open Questions (zamiast zgadywania przez model).
 */
export function fillSystemDefaults(spec: DesignSpec): void {
  const assumed: string[] = []
  if (!spec.breakpoints?.length) {
    spec.breakpoints = [
      { name: 'sm', value: '640px' },
      { name: 'md', value: '768px' },
      { name: 'lg', value: '1024px' },
      { name: 'xl', value: '1280px' },
    ]
    assumed.push('breakpoints')
  }
  if (!spec.zIndex?.length) {
    spec.zIndex = [
      { name: 'dropdown', value: '10' },
      { name: 'sticky', value: '20' },
      { name: 'overlay', value: '40' },
      { name: 'modal', value: '50' },
      { name: 'toast', value: '60' },
    ]
    assumed.push('z-index layers')
  }
  if (!spec.motion?.length) {
    spec.motion = [
      { name: 'fast', value: '120ms' },
      { name: 'base', value: '200ms' },
      { name: 'slow', value: '320ms' },
      { name: 'standard', value: 'cubic-bezier(0.2, 0, 0, 1)' },
    ]
    assumed.push('motion')
  }
  if (!spec.borders?.length) {
    spec.borders = [{ name: 'hairline', value: '1px' }]
    assumed.push('border widths')
  }
  if (!spec.focusRing) {
    const accent =
      spec.colors.find((c) =>
        /primary|accent|brand|action|link|focus/i.test(`${c.name} ${c.role} ${c.token}`)
      ) ?? spec.colors[0]
    spec.focusRing = `2px solid ${accent?.hex ?? '#2563eb'}`
    assumed.push('focus ring')
  }
  spec.systemAssumed = assumed
}

export function validateDesignSpec(input: unknown): DesignSpec {
  const root = isObject(input) && isObject(input.spec) ? input.spec : input
  if (!isObject(root)) throw new InvalidModelOutputError(t('spec.notObject'))
  const v = root

  const problems: string[] = []
  /** Wartości, których nie da się użyć w CSS — trafiają do Open Questions. */
  const unclear: string[] = []
  const length = (where: string, raw: unknown, opts?: { unitless?: boolean }) => {
    const value = str(raw, 80)
    if (!value) return ''
    const clean = cssLength(value, opts)
    if (!clean) unclear.push(`${where}: „${value}”`)
    return clean ?? ''
  }
  const lengthItem = (where: string, item: SpecNameValue | null): SpecNameValue | null => {
    if (!item) return null
    const value = length(`${where} „${item.name}”`, item.value)
    return value ? { name: item.name, value } : null
  }

  const colors = list(v.colors, (c) => {
    if (!isObject(c)) return null
    const hex = normalizeHex(c.hex ?? c.value)
    const name = str(c.name, 60)
    if (!hex || !name) return null
    return {
      name,
      hex,
      token: token(c.token, 'color', name),
      role: str(c.role, 400),
      sources: ids(c.sources),
      assumed: c.assumed === true,
    }
  })
  // Unikalne tokeny — duplikat dostaje sufiks.
  const seenTokens = new Set<string>()
  for (const c of colors) {
    let t = c.token
    for (let i = 2; seenTokens.has(t); i++) t = `${c.token}-${i}`
    c.token = t
    seenTokens.add(t)
  }
  if (colors.length === 0) problems.push(t('spec.problem.colors'))

  const typo = isObject(v.typography) ? v.typography : {}
  const families = list(typo.families, (f) => {
    if (!isObject(f)) return null
    const name = str(f.name, 60)
    if (!name) return null
    return {
      name,
      token: token(f.token, 'font', name),
      substitute: str(f.substitute, 200),
      weights: list(f.weights, (w) => {
        const n = Number(w)
        return Number.isFinite(n) && n >= 100 && n <= 1000 ? n : null
      }),
      sizes: strList(f.sizes, 20, 20),
      lineHeights: strList(f.lineHeights, 20, 20),
      role: str(f.role, 600),
      sources: ids(f.sources),
      assumed: f.assumed === true,
    }
  })
  if (families.length === 0) problems.push(t('spec.problem.families'))

  const scale = list(typo.scale, (r) => {
    if (!isObject(r)) return null
    const role = str(r.role, 40)
    const size = role ? length(`font size „${role}”`, r.size) : ''
    if (!role || !size) return null
    return {
      role,
      family: str(r.family, 60) || '—',
      weight: str(r.weight, 10).match(/\d{3}/)?.[0] ?? '—',
      size,
      lineHeight: length(`line height „${role}”`, r.lineHeight, { unitless: true }) || '—',
      letterSpacing: length(`letter spacing „${role}”`, r.letterSpacing) || '—',
      token: token(r.token, 'text', role),
    }
  })

  const sp = isObject(v.spacing) ? v.spacing : {}
  const spacing = {
    baseUnit: length('spacing base unit', sp.baseUnit) || '4px',
    density: str(sp.density, 40) || 'comfortable',
    scale: list(sp.scale, (s) => lengthItem('spacing', nameValue(s))),
    assumed: sp.assumed === true,
  }

  const lay = isObject(v.layout) ? v.layout : {}
  const layout = {
    pageMaxWidth: length('page max-width', lay.pageMaxWidth),
    sectionGap: length('section gap', lay.sectionGap),
    cardPadding: length('card padding', lay.cardPadding),
    elementGap: length('element gap', lay.elementGap),
    description: text(lay.description),
  }

  const components = list(v.components, (c) => {
    if (!isObject(c)) return null
    const name = str(c.name, 80)
    const description = text(c.description, 1500)
    if (!name || !description) return null
    return {
      name,
      role: str(c.role, 200),
      description,
      states: strList(c.states, 12, 200),
      sources: ids(c.sources),
      assumed: c.assumed === true,
    }
  })
  if (components.length === 0) problems.push(t('spec.problem.components'))

  const screens = list(v.screens, (s) => {
    if (!isObject(s)) return null
    const name = str(s.name, 80)
    if (!name) return null
    return {
      name,
      purpose: str(s.purpose, 400),
      elements: strList(s.elements, 20, 200),
      sources: ids(s.sources),
    }
  })

  const voiceIn = isObject(v.voice) ? v.voice : {}
  const agent = isObject(v.agentGuide) ? v.agentGuide : {}

  const spec: DesignSpec = {
    name: str(v.name, 120),
    tagline: str(v.tagline, 200),
    theme: v.theme === 'dark' || v.theme === 'mixed' ? v.theme : 'light',
    overview: text(v.overview, 3000),
    colors,
    typography: { families, scale },
    spacing,
    radii: list(v.radii, (r) => lengthItem('radius', nameValue(r, 'element'))),
    shadows: list(v.shadows, (s) => {
      const item = nameValue(s)
      if (!item) return null
      const value = cssShadow(item.value)
      if (!value) unclear.push(`shadow „${item.name}”: „${item.value}”`)
      return value ? { name: item.name, value } : null
    }),
    layout,
    components,
    screens,
    flows: strList(v.flows, 30, 300),
    voice: { tone: text(voiceIn.tone, 1000), examples: strList(voiceIn.examples, 20, 200) },
    dos: strList(v.dos, 20),
    donts: strList(v.donts, 20),
    surfaces: list(v.surfaces, (s) => {
      if (!isObject(s)) return null
      const name = str(s.name, 60)
      const raw = str(s.value, 60)
      const value = normalizeHex(raw) ?? (/^(rgba?|hsla?|oklch)\([^()]*\)$/i.test(raw) ? raw : null)
      if (!name || !value) return null
      const level = Number(s.level)
      return {
        level: Number.isFinite(level) ? level : 0,
        name,
        value,
        purpose: str(s.purpose, 300),
      }
    }),
    elevation: text(v.elevation, 1500),
    imagery: text(v.imagery, 1500),
    agentGuide: {
      quickColors: list(agent.quickColors, (q) => nameValue(q, 'label')),
      componentPrompts: strList(agent.componentPrompts, 10, 800),
    },
    similarBrands: list(
      v.similarBrands,
      (b) => {
        if (!isObject(b)) return null
        const name = str(b.name, 60)
        return name ? { name, reason: str(b.reason, 300) } : null
      },
      8
    ),
    openQuestions: strList(v.openQuestions, 20),
  }
  // System (AI-9): breakpointy, warstwy, ruch, obramowania, focus.
  spec.breakpoints = list(v.breakpoints, (b) => lengthItem('breakpoint', nameValue(b)), 8)
  spec.borders = list(v.borders, (b) => lengthItem('border width', nameValue(b)), 8)
  spec.zIndex = list(
    v.zIndex,
    (z) => {
      const item = nameValue(z)
      const n = item ? Number(item.value) : NaN
      return item && Number.isInteger(n) && Math.abs(n) <= 100_000
        ? { name: item.name, value: String(n) }
        : null
    },
    10
  )
  spec.motion = list(
    v.motion,
    (m) => {
      const item = nameValue(m)
      if (!item) return null
      const value = cssMotion(item.value)
      if (!value) unclear.push(`motion „${item.name}”: „${item.value}”`)
      return value ? { name: item.name, value } : null
    },
    10
  )
  const ring = str(v.focusRing, 80)
  spec.focusRing = ring && FOCUS_RING.test(ring) ? ring : ''
  if (ring && !spec.focusRing) unclear.push(`focus ring: „${ring}”`)
  spec.iconography = text(v.iconography, 800)
  normalizeTokenNames(spec)
  fillSystemDefaults(spec)

  if (unclear.length) {
    spec.openQuestions.push(
      `These values were descriptions rather than CSS and were left out of the tokens — confirm exact values: ${unclear.slice(0, 12).join('; ')}.`
    )
  }

  if (!spec.name) problems.push(t('spec.problem.name'))
  if (!spec.overview) problems.push(t('spec.problem.overview'))
  if (spec.dos.length === 0 || spec.donts.length === 0) problems.push(t('spec.problem.dosDonts'))

  if (problems.length) {
    throw new InvalidModelOutputError(t('spec.incomplete', { problems: problems.join('; ') }))
  }
  return spec
}

// ---------------------------------------------------------------------------
// Ugruntowanie
// ---------------------------------------------------------------------------

const REF_PATTERN = /\[A(\d+)\]/g

function refsInText(value: string): number[] {
  return [...value.matchAll(REF_PATTERN)].map((m) => Number(m[1]))
}

/** Wszystkie wolne teksty specyfikacji (do szukania odwołań [A<id>]). */
function freeTexts(spec: DesignSpec): string[] {
  return [
    spec.overview,
    spec.layout.description,
    spec.elevation,
    spec.imagery,
    spec.voice.tone,
    ...spec.voice.examples,
    ...spec.flows,
    ...spec.dos,
    ...spec.donts,
    ...spec.openQuestions,
    ...spec.colors.map((c) => c.role),
    ...spec.typography.families.map((f) => f.role),
    ...spec.components.flatMap((c) => [c.description, c.role, ...c.states]),
    ...spec.screens.flatMap((s) => [s.purpose, ...s.elements]),
  ]
}

/**
 * Kontrola ugruntowania. Zwraca listę problemów (pusta = OK). Pozycje bez
 * źródeł i bez flagi `assumed` są oznaczane jako założenia (mutacja spec).
 */
export function groundSpec(spec: DesignSpec, allowedIds: number[]): string[] {
  const allowed = new Set(allowedIds)
  const referenced = new Set<number>()
  const errors: string[] = []

  const check = (where: string, sources: number[]) => {
    const unknown = sources.filter((id) => !allowed.has(id))
    if (unknown.length) {
      errors.push(t('spec.unknownRefs', { where, ids: unknown.map((i) => `A${i}`).join(', ') }))
    }
    for (const id of sources) if (allowed.has(id)) referenced.add(id)
  }

  for (const c of spec.colors) {
    check(t('spec.where.color', { name: c.name }), c.sources)
    if (c.sources.length === 0) c.assumed = true
  }
  for (const f of spec.typography.families) {
    check(t('spec.where.font', { name: f.name }), f.sources)
    if (f.sources.length === 0) f.assumed = true
  }
  for (const c of spec.components) {
    check(t('spec.where.component', { name: c.name }), c.sources)
    if (c.sources.length === 0) c.assumed = true
  }
  for (const s of spec.screens) check(t('spec.where.screen', { name: s.name }), s.sources)
  freeTexts(spec).forEach((text) => check(t('spec.where.text'), refsInText(text)))

  if (allowed.size > 0 && referenced.size === 0) {
    errors.push(t('spec.noSources'))
  }
  return errors
}

/** Mapowanie asset → sekcje dokumentu, w których jest użyty. */
export function specReferences(spec: DesignSpec): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>()
  const add = (id: number, section: string) => {
    if (!map.has(id)) map.set(id, new Set())
    map.get(id)!.add(section)
  }
  spec.colors.forEach((c) => c.sources.forEach((id) => add(id, 'Colors')))
  spec.typography.families.forEach((f) => f.sources.forEach((id) => add(id, 'Typography')))
  spec.components.forEach((c) => c.sources.forEach((id) => add(id, 'Components')))
  spec.screens.forEach((s) => s.sources.forEach((id) => add(id, 'Screens')))
  refsInText(spec.overview).forEach((id) => add(id, 'Overview'))
  refsInText(spec.layout.description).forEach((id) => add(id, 'Layout'))
  ;[...spec.dos, ...spec.donts].flatMap(refsInText).forEach((id) => add(id, "Do's and Don'ts"))
  refsInText([spec.voice.tone, ...spec.voice.examples].join(' ')).forEach((id) => add(id, 'Voice'))
  spec.flows.flatMap(refsInText).forEach((id) => add(id, 'Flows'))
  return map
}

// ---------------------------------------------------------------------------
// Rola i aspekty materiałów
// ---------------------------------------------------------------------------

/**
 * Wymusza kategorie materiałów niezależnie od modelu: źródłem koloru może być
 * tylko materiał dozwolony dla „colors”, fontu — dla „typography”, komponentu
 * — dla „components” albo „layout”. Pozycja bez dozwolonego źródła staje się
 * założeniem †. Zwraca opisy zdjętych odwołań (diagnostyka).
 */
export function enforceUsage(spec: DesignSpec, usages: Map<number, AssetUsage>): string[] {
  const stripped: string[] = []
  const filter = (where: string, sources: number[], ok: (u: AssetUsage | undefined) => boolean) => {
    const kept = sources.filter((id) => ok(usages.get(id)))
    for (const id of sources) if (!kept.includes(id)) stripped.push(`${where}: A${id}`)
    return kept
  }
  // Kolor wyłącznie z materiału „unikaj” albo bez aspektu „colors” nie trafia do
  // tokenów — oznaczenie † nie wystarczy, bo narzędzia i tak użyłyby hexa (AI-4).
  spec.colors = spec.colors.filter((c) => {
    const before = c.sources.length
    c.sources = filter(`color ${c.name}`, c.sources, (u) => allowsAspect(u, 'colors'))
    return c.confirmed || !before || c.sources.length > 0
  })
  for (const f of spec.typography.families) {
    const before = f.sources.length
    f.sources = filter(`font ${f.name}`, f.sources, (u) => allowsAspect(u, 'typography'))
    if (before && !f.sources.length) f.assumed = true
  }
  for (const c of spec.components) {
    const before = c.sources.length
    c.sources = filter(
      `component ${c.name}`,
      c.sources,
      (u) => allowsAspect(u, 'components') || allowsAspect(u, 'layout')
    )
    if (before && !c.sources.length) c.assumed = true
  }
  for (const s of spec.screens) {
    s.sources = filter(`screen ${s.name}`, s.sources, (u) => u?.role !== 'avoid')
  }
  return stripped
}

// ---------------------------------------------------------------------------
// Podmiana wartości w tekstach specyfikacji
// ---------------------------------------------------------------------------

/**
 * Zmienia (w miejscu) każdy tekst specyfikacji — poza nazwami tokenów, które
 * są stabilnymi identyfikatorami (edycje i eksporty adresują token).
 */
export function rewriteSpecStrings(spec: DesignSpec, fn: (text: string) => string): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === 'string') node[i] = fn(v)
        else walk(v)
      })
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'token') continue
        if (typeof v === 'string') obj[k] = fn(v)
        else walk(v)
      }
    }
  }
  walk(spec)
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Hex z granicą: `#1a2b3c` nie trafia w środek `#1a2b3cff`; zapis skrócony
 * (`#abc` dla `#aabbcc`) też jest podmieniany.
 */
export function replaceHexInSpec(spec: DesignSpec, from: string, to: string): void {
  if (from === to) return
  const forms = [from]
  const m = from.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i)
  if (m) forms.push(`#${m[1]}${m[2]}${m[3]}`)
  const pattern = new RegExp(`(?:${forms.map(escapeRe).join('|')})(?![0-9a-f])`, 'gi')
  rewriteSpecStrings(spec, (text) => text.replace(pattern, to))
}

// ---------------------------------------------------------------------------
// Kolory a materiały
// ---------------------------------------------------------------------------

/**
 * Progi podobieństwa (OKLab, AI-4): odcień z materiału ± drobne przybliżenie
 * modelu. Szarości są ciaśniej — sąsiednie szarości to różne role (tekst/tło).
 */
const SAME_COLOR = 0.03
const SAME_GRAY = 0.02

function chroma(hex: string): number {
  const [, a, b] = hexToOklab(hex)
  return Math.hypot(a, b)
}

/** Czy dwa hexy to „ten sam” kolor w sensie materiałów (próg zależny od nasycenia). */
export function sameColor(a: string, b: string): boolean {
  const gray = chroma(a) < 0.03 && chroma(b) < 0.03
  return colorDistance(a, b) <= (gray ? SAME_GRAY : SAME_COLOR)
}

/**
 * Kolor cytujący materiał musi być widoczny w palecie albo kolorach tekstu
 * odczytanych z tego materiału w etapie 1 (albo w innym materiale — wtedy
 * źródło jest poprawiane) i jest przyciągany do obserwowanego hexa. Kolor,
 * którego nie ma w żadnej palecie, to propozycja modelu (np. „typowy” czerwony
 * błędu) — dostaje flagę założenia †. Źródło bez palety (link, PDF) nie
 * potwierdza koloru — też †, choć cytat zostaje.
 * `palettes`: assetId → kolory hex z analizy. Zwraca nazwy oznaczonych kolorów.
 */
export function verifyColorEvidence(spec: DesignSpec, palettes: Map<number, string[]>): string[] {
  const flagged: string[] = []
  const nearest = (ids: number[], hex: string) => {
    let best: { hex: string; d: number } | null = null
    for (const id of ids) {
      for (const p of palettes.get(id) ?? []) {
        if (!sameColor(p, hex)) continue
        const d = colorDistance(p, hex)
        if (!best || d < best.d) best = { hex: p, d }
      }
    }
    return best
  }
  for (const c of [...spec.colors]) {
    if (c.confirmed || c.assumed || c.sources.length === 0) continue
    let match = nearest(c.sources, c.hex)
    if (!match) {
      const elsewhere = [...palettes.keys()].filter((id) => nearest([id], c.hex))
      if (elsewhere.length) {
        c.sources = elsewhere
        match = nearest(elsewhere, c.hex)
      }
    }
    if (!match) {
      if (c.sources.every((id) => !(palettes.get(id) ?? []).length)) {
        // Nie ma z czym porównać (link, notatka, PDF) — niezweryfikowane.
        c.assumed = true
      } else {
        c.assumed = true
        c.sources = []
      }
      flagged.push(c.name)
      continue
    }
    // Przybliżenie modelu → dokładny hex z materiału, w całym dokumencie.
    if (match.hex !== c.hex) replaceHexInSpec(spec, c.hex, match.hex)
  }
  return flagged
}
