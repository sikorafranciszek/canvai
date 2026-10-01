import type { DesignSpec } from '#services/design/spec'
import { contrastRatio, fixContrast, wcagLevel, type WcagLevel } from '#shared/color'

/**
 * Ocena jakości DESIGN.md: ile wartości wynika z materiałów (a ile to
 * założenia †), czego brakuje, żeby UI dało się zbudować bez zgadywania,
 * i czy pary tekst/tło spełniają WCAG AA. Czysty moduł — liczony przy
 * każdym odczycie dokumentu, nie wymaga ponownej generacji.
 */

export interface ContrastCheck {
  text: { name: string; hex: string; token: string }
  background: { name: string; hex: string }
  ratio: number
  level: WcagLevel
  /** Najbliższy odcień tekstu spełniający AA (4.5:1), gdy obecny nie spełnia. */
  suggestion: string | null
}

export type GapSeverity = 'high' | 'medium' | 'low'

export interface QualityGap {
  /** Klucz komunikatu: `quality.gap.<id>` i podpowiedź `quality.fix.<id>`. */
  id:
    | 'few_materials'
    | 'fonts_assumed'
    | 'colors_assumed'
    | 'no_error_color'
    | 'no_success_color'
    | 'no_focus_state'
    | 'no_disabled_state'
    | 'small_type_scale'
    | 'spacing_assumed'
    | 'no_screens'
    | 'no_flows'
    | 'no_microcopy'
    | 'contrast'
  severity: GapSeverity
  params?: Record<string, string | number>
}

export interface QualityReport {
  score: number
  grade: 'excellent' | 'good' | 'fair' | 'weak'
  grounded: number
  total: number
  assumed: { kind: 'color' | 'font' | 'component' | 'spacing'; name: string }[]
  gaps: QualityGap[]
  contrast: ContrastCheck[]
}

const TEXT_RE =
  /\b(text|ink|foreground|fg|heading|headline|body|label|muted|caption|copy|link|on[- ]?surface)\b/i
const BG_RE = /\b(background|bg|surface|canvas|page|card|paper|base|panel|sheet|backdrop)\b/i

/** Pary tekst × tło do sprawdzenia kontrastu (heurystyka po nazwach, tokenach i rolach). */
export function contrastChecks(spec: DesignSpec): ContrastCheck[] {
  const texts = spec.colors.filter((c) => {
    const tokenText = /^--color-(text|ink|fg|foreground|on-)/.test(c.token)
    return (
      tokenText || (TEXT_RE.test(`${c.name} ${c.token}`) && !BG_RE.test(`${c.name} ${c.token}`))
    )
  })
  const surfaces = [...spec.surfaces]
    .filter((s) => /^#[0-9a-f]{6}$/i.test(s.value))
    .sort((a, b) => a.level - b.level)
    .map((s) => ({ name: s.name, hex: s.value }))
  const bgColors = spec.colors
    .filter((c) => BG_RE.test(`${c.name} ${c.token}`) && !texts.includes(c))
    .map((c) => ({ name: c.name, hex: c.hex }))
  // Główne tło i pierwsza powierzchnia (karta) — tam stoi większość tekstu.
  const backgrounds: { name: string; hex: string }[] = []
  for (const bg of [...surfaces, ...bgColors]) {
    if (backgrounds.length >= 2) break
    if (!backgrounds.some((b) => b.hex === bg.hex)) backgrounds.push(bg)
  }
  if (!backgrounds.length) return []

  const checks: ContrastCheck[] = []
  for (const text of texts.slice(0, 8)) {
    for (const bg of backgrounds) {
      if (text.hex === bg.hex) continue
      const ratio = Math.round(contrastRatio(text.hex, bg.hex) * 100) / 100
      const level = wcagLevel(ratio)
      checks.push({
        text: { name: text.name, hex: text.hex, token: text.token },
        background: bg,
        ratio,
        level,
        suggestion: ratio < 4.5 ? fixContrast(text.hex, bg.hex, 4.5) : null,
      })
    }
  }
  return checks
}

const WEIGHT: Record<GapSeverity, number> = { high: 0.25, medium: 0.12, low: 0.05 }

export function assessQuality(spec: DesignSpec, materials: number): QualityReport {
  const assumed: QualityReport['assumed'] = [
    ...spec.colors.filter((c) => c.assumed).map((c) => ({ kind: 'color' as const, name: c.name })),
    ...spec.typography.families
      .filter((f) => f.assumed)
      .map((f) => ({ kind: 'font' as const, name: f.name })),
    ...spec.components
      .filter((c) => c.assumed)
      .map((c) => ({ kind: 'component' as const, name: c.name })),
    ...(spec.spacing.assumed ? [{ kind: 'spacing' as const, name: spec.spacing.baseUnit }] : []),
  ]
  const total = spec.colors.length + spec.typography.families.length + spec.components.length + 1
  const grounded = total - assumed.length

  const gaps: QualityGap[] = []
  const add = (id: QualityGap['id'], severity: GapSeverity, params?: QualityGap['params']) =>
    gaps.push({ id, severity, ...(params ? { params } : {}) })
  const colorText = spec.colors.map((c) => `${c.name} ${c.token} ${c.role}`).join(' | ')
  const states = spec.components.flatMap((c) => c.states).join(' | ')

  if (materials < 3) add('few_materials', 'medium', { count: materials })
  if (spec.typography.families.some((f) => f.assumed)) add('fonts_assumed', 'high')
  const assumedColors = spec.colors.filter((c) => c.assumed).length
  if (spec.colors.length && assumedColors / spec.colors.length > 0.4) {
    add('colors_assumed', 'high', { assumed: assumedColors, total: spec.colors.length })
  }
  if (!/\b(error|danger|destructive|negative|critical)\b/i.test(colorText))
    add('no_error_color', 'medium')
  if (!/\b(success|positive|confirm|valid)\b/i.test(colorText)) add('no_success_color', 'low')
  if (!/focus/i.test(states)) add('no_focus_state', 'medium')
  if (!/disabled/i.test(states)) add('no_disabled_state', 'low')
  if (spec.typography.scale.length < 4)
    add('small_type_scale', 'medium', { rows: spec.typography.scale.length })
  if (spec.spacing.assumed) add('spacing_assumed', 'low')
  if (spec.screens.length === 0) add('no_screens', 'medium')
  else if (spec.screens.length > 1 && spec.flows.length === 0) add('no_flows', 'low')
  if (!spec.voice.examples.some((e) => !/^\s*proposed\s*:/i.test(e))) add('no_microcopy', 'low')

  const contrast = contrastChecks(spec)
  const failing = contrast.filter((c) => c.ratio < 4.5)
  if (failing.length) add('contrast', 'high', { count: failing.length })

  const groundedScore = total ? grounded / total : 1
  const gapScore = Math.max(0, 1 - gaps.reduce((s, g) => s + WEIGHT[g.severity], 0))
  const contrastScore = contrast.length ? 1 - failing.length / contrast.length : 1
  const score = Math.round((groundedScore * 0.5 + gapScore * 0.3 + contrastScore * 0.2) * 100)
  const grade = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'weak'

  const order: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 }
  gaps.sort((a, b) => order[a.severity] - order[b.severity])
  return { score, grade, grounded, total, assumed, gaps, contrast }
}
