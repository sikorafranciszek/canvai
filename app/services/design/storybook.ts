import type { DesignSpec, SpecComponent } from '#services/design/spec'
import { renderCssVariables, slug } from '#services/design/renderer'

/**
 * Szkielety komponentów do Storybooka (FEAT-6): jeden plik CSF3 z tokenami
 * (`:root` wstrzyknięty dekoratorem), do pięciu komponentów ze specyfikacji
 * i osobną historią dla każdego stanu. Style wyłącznie przez zmienne CSS —
 * zespół podmienia szkielet na własną implementację, tokeny zostają.
 */

type Kind = 'button' | 'input' | 'card' | 'badge' | 'nav' | 'box'
type State =
  'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'error' | 'selected' | 'loading'

const KINDS: [Kind, RegExp][] = [
  ['button', /button|cta|przycisk/i],
  ['input', /input|field|search|textarea|select|pole|composer/i],
  ['badge', /badge|chip|tag|pill|label|status/i],
  ['nav', /nav|header|tab|menu|toolbar|sidebar/i],
  ['card', /card|tile|panel|modal|dialog|sheet|list item/i],
]

const STATES: [State, RegExp][] = [
  ['hover', /^hover/i],
  ['focus', /^focus/i],
  ['active', /^(active|pressed)/i],
  ['disabled', /^disabled/i],
  ['error', /^(error|invalid|danger)/i],
  ['selected', /^(selected|checked|current|on\b)/i],
  ['loading', /^loading/i],
]

function kindOf(c: SpecComponent): Kind {
  const text = `${c.name} ${c.role}`
  return KINDS.find(([, re]) => re.test(text))?.[0] ?? 'box'
}

function statesOf(c: SpecComponent): State[] {
  const found = c.states
    .map((s) => STATES.find(([, re]) => re.test(s.trim()))?.[0])
    .filter((s): s is State => Boolean(s))
  return ['default', ...new Set(found)].slice(0, 5) as State[]
}

function pick(spec: DesignSpec, re: RegExp, fallback: string): string {
  const c = spec.colors.find((x) => re.test(`${x.name} ${x.role}`))
  return c ? `var(${c.token})` : fallback
}

function ident(name: string, used: Set<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('')
      .replace(/^[^A-Za-z]+/, '')
      .replace(/^./, (ch) => ch.toUpperCase()) || 'Component'
  let id = base
  for (let i = 2; used.has(id); i++) id = `${base}${i}`
  used.add(id)
  return id
}

export function renderStorybook(spec: DesignSpec): string {
  const ink = pick(spec, /text|ink|foreground|primary text|body/i, '#111')
  const surface = pick(spec, /surface|card|background|canvas|paper|base/i, '#fff')
  const accent = pick(spec, /primary|accent|brand|action|cta/i, ink)
  const border = pick(spec, /border|hairline|divider|stroke|outline/i, 'rgba(0,0,0,.15)')
  const danger = pick(spec, /error|danger|destructive|alert/i, '#b42318')
  const font = spec.typography.families[0]
    ? `var(${spec.typography.families[0].token})`
    : 'system-ui'
  const radius = spec.radii[0] ? `var(--radius-${slug(spec.radii[0].name)})` : '8px'
  const focus = spec.focusRing ? 'var(--focus-ring)' : `2px solid ${accent}`

  const used = new Set<string>()
  const components = spec.components.slice(0, 5).map((c) => ({
    spec: c,
    id: ident(c.name, used),
    kind: kindOf(c),
    states: statesOf(c),
  }))

  const lines: string[] = []
  lines.push(
    `/**`,
    ` * ${spec.name} — szkielety komponentów z DESIGN.md (canvai).`,
    ` * Style wyłącznie przez tokeny CSS; podmień szkielety na własne komponenty.`,
    ` * Wymaga: @storybook/react (CSF3), React 18+.`,
    ` */`,
    `import type { Meta, StoryObj } from '@storybook/react'`,
    `import type { CSSProperties, ReactNode } from 'react'`,
    ``,
    `const TOKENS = ${JSON.stringify(renderCssVariables(spec))}`,
    ``,
    `type State = 'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'error' | 'selected' | 'loading'`,
    ``,
    `/** Wygląd stanu wspólny dla szkieletów (statycznie — bez interakcji). */`,
    `function stateStyle(state: State): CSSProperties {`,
    `  switch (state) {`,
    `    case 'hover':`,
    `      return { filter: 'brightness(0.94)' }`,
    `    case 'focus':`,
    `      return { outline: ${JSON.stringify(focus)}, outlineOffset: 2 }`,
    `    case 'active':`,
    `      return { transform: 'scale(0.98)' }`,
    `    case 'disabled':`,
    `      return { opacity: 0.5, cursor: 'not-allowed' }`,
    `    case 'error':`,
    `      return { borderColor: ${JSON.stringify(danger)}, boxShadow: \`0 0 0 1px ${danger}\` }`,
    `    case 'selected':`,
    `      return { boxShadow: \`inset 0 0 0 2px ${accent}\` }`,
    `    case 'loading':`,
    `      return { opacity: 0.7, cursor: 'progress' }`,
    `    default:`,
    `      return {}`,
    `  }`,
    `}`,
    ``,
    `const base: CSSProperties = { fontFamily: ${JSON.stringify(font)}, color: ${JSON.stringify(ink)} }`,
    ``
  )

  for (const c of components) {
    const label = JSON.stringify(c.spec.name)
    const note = JSON.stringify(c.spec.description.slice(0, 160))
    lines.push(
      `/** ${c.spec.name}${c.spec.description ? ` — ${c.spec.description.replace(/\*\//g, '* /').slice(0, 200)}` : ''} */`
    )
    lines.push(
      `export function ${c.id}({ state = 'default', children }: { state?: State; children?: ReactNode }) {`
    )
    switch (c.kind) {
      case 'button':
        lines.push(
          `  return (`,
          `    <button`,
          `      type="button"`,
          `      disabled={state === 'disabled'}`,
          `      style={{ ...base, background: ${JSON.stringify(accent)}, color: ${JSON.stringify(surface)}, border: 0, borderRadius: ${JSON.stringify(radius)}, padding: '10px 16px', fontWeight: 600, ...stateStyle(state) }}`,
          `    >`,
          `      {state === 'loading' ? '…' : (children ?? ${label})}`,
          `    </button>`,
          `  )`
        )
        break
      case 'input':
        lines.push(
          `  return (`,
          `    <input`,
          `      aria-label=${label}`,
          `      placeholder=${label}`,
          `      disabled={state === 'disabled'}`,
          `      aria-invalid={state === 'error'}`,
          `      style={{ ...base, background: ${JSON.stringify(surface)}, border: \`1px solid ${border}\`, borderRadius: ${JSON.stringify(radius)}, padding: '10px 12px', minWidth: 260, ...stateStyle(state) }}`,
          `    />`,
          `  )`
        )
        break
      case 'badge':
        lines.push(
          `  return (`,
          `    <span style={{ ...base, display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: \`color-mix(in srgb, ${accent} 14%, transparent)\`, color: ${JSON.stringify(accent)}, ...stateStyle(state) }}>`,
          `      {children ?? ${label}}`,
          `    </span>`,
          `  )`
        )
        break
      case 'nav':
        lines.push(
          `  return (`,
          `    <nav style={{ ...base, display: 'flex', gap: 16, alignItems: 'center', padding: '12px 16px', background: ${JSON.stringify(surface)}, borderBottom: \`1px solid ${border}\`, ...stateStyle(state) }}>`,
          `      <strong>{children ?? ${label}}</strong>`,
          `      <a href="#" style={{ color: ${JSON.stringify(accent)} }}>Link</a>`,
          `      <a href="#" style={{ color: 'inherit' }}>Link</a>`,
          `    </nav>`,
          `  )`
        )
        break
      default:
        lines.push(
          `  return (`,
          `    <div style={{ ...base, background: ${JSON.stringify(surface)}, border: \`1px solid ${border}\`, borderRadius: ${JSON.stringify(radius)}, padding: 20, maxWidth: 360, ...stateStyle(state) }}>`,
          `      <strong>{children ?? ${label}}</strong>`,
          `      <p style={{ margin: '8px 0 0', opacity: 0.8 }}>{${note}}</p>`,
          `    </div>`,
          `  )`
        )
    }
    lines.push(`}`, ``)
  }

  lines.push(
    `const meta: Meta = {`,
    `  title: ${JSON.stringify(`Design system/${spec.name}`)},`,
    `  decorators: [`,
    `    (Story) => (`,
    `      <div style={{ ...base, background: ${JSON.stringify(surface)}, padding: 24 }}>`,
    `        <style>{TOKENS}</style>`,
    `        <Story />`,
    `      </div>`,
    `    ),`,
    `  ],`,
    `}`,
    `export default meta`,
    ``,
    `type Story = StoryObj`,
    ``
  )
  for (const c of components) {
    for (const s of c.states) {
      const name = `${c.id}${s[0].toUpperCase()}${s.slice(1)}`
      lines.push(`export const ${name}: Story = { render: () => <${c.id} state="${s}" /> }`)
    }
  }
  return lines.join('\n') + '\n'
}
