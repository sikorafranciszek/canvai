import { InvalidModelOutputError } from '#services/ai/types'
import { normalizeHex } from '#services/ai/schemas'

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

export function validateDesignSpec(input: unknown): DesignSpec {
  const root = isObject(input) && isObject(input.spec) ? input.spec : input
  if (!isObject(root)) throw new InvalidModelOutputError('Specyfikacja: oczekiwano obiektu JSON')
  const v = root

  const problems: string[] = []

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
  if (colors.length === 0) problems.push('colors: wymagany co najmniej jeden kolor z poprawnym hex')

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
  if (families.length === 0) problems.push('typography.families: wymagana co najmniej jedna rodzina fontów')

  const scale = list(typo.scale, (r) => {
    if (!isObject(r)) return null
    const role = str(r.role, 40)
    const size = str(r.size, 20)
    if (!role || !size) return null
    return {
      role,
      family: str(r.family, 60) || '—',
      weight: str(r.weight, 10) || '—',
      size,
      lineHeight: str(r.lineHeight, 10) || '—',
      letterSpacing: str(r.letterSpacing, 20) || '—',
      token: token(r.token, 'text', role),
    }
  })

  const sp = isObject(v.spacing) ? v.spacing : {}
  const spacing = {
    baseUnit: str(sp.baseUnit, 20) || '4px',
    density: str(sp.density, 40) || 'comfortable',
    scale: list(sp.scale, (s) => nameValue(s)),
    assumed: sp.assumed === true,
  }

  const lay = isObject(v.layout) ? v.layout : {}
  const layout = {
    pageMaxWidth: str(lay.pageMaxWidth, 20),
    sectionGap: str(lay.sectionGap, 20),
    cardPadding: str(lay.cardPadding, 20),
    elementGap: str(lay.elementGap, 20),
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
  if (components.length === 0) problems.push('components: wymagany co najmniej jeden komponent')

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
    radii: list(v.radii, (r) => nameValue(r, 'element')),
    shadows: list(v.shadows, (s) => nameValue(s)),
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
      const value = str(s.value, 40)
      if (!name || !value) return null
      const level = Number(s.level)
      return {
        level: Number.isFinite(level) ? level : 0,
        name,
        value: normalizeHex(value) ?? value,
        purpose: str(s.purpose, 300),
      }
    }),
    elevation: text(v.elevation, 1500),
    imagery: text(v.imagery, 1500),
    agentGuide: {
      quickColors: list(agent.quickColors, (q) => nameValue(q, 'label')),
      componentPrompts: strList(agent.componentPrompts, 10, 800),
    },
    similarBrands: list(v.similarBrands, (b) => {
      if (!isObject(b)) return null
      const name = str(b.name, 60)
      return name ? { name, reason: str(b.reason, 300) } : null
    }, 8),
    openQuestions: strList(v.openQuestions, 20),
  }

  if (!spec.name) problems.push('name: brak nazwy produktu/marki')
  if (!spec.overview) problems.push('overview: brak opisu')
  if (spec.dos.length === 0 || spec.donts.length === 0) problems.push("dos/donts: wymagane obie listy")

  if (problems.length) {
    throw new InvalidModelOutputError(`Specyfikacja niekompletna: ${problems.join('; ')}`)
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
      errors.push(`${where} odwołuje się do nieistniejących assetów: ${unknown.map((i) => `A${i}`).join(', ')}`)
    }
    for (const id of sources) if (allowed.has(id)) referenced.add(id)
  }

  for (const c of spec.colors) {
    check(`Kolor „${c.name}”`, c.sources)
    if (c.sources.length === 0) c.assumed = true
  }
  for (const f of spec.typography.families) {
    check(`Font „${f.name}”`, f.sources)
    if (f.sources.length === 0) f.assumed = true
  }
  for (const c of spec.components) {
    check(`Komponent „${c.name}”`, c.sources)
    if (c.sources.length === 0) c.assumed = true
  }
  for (const s of spec.screens) check(`Ekran „${s.name}”`, s.sources)
  freeTexts(spec).forEach((t) => check('Tekst', refsInText(t)))

  if (allowed.size > 0 && referenced.size === 0) {
    errors.push('Specyfikacja nie wskazuje żadnego assetu źródłowego (pola sources / [A<id>])')
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
