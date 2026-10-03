import { specReferences, type DesignSpec } from '#services/design/spec'
import { contrastChecks } from '#services/design/quality'
import { describeUsage, isDefaultUsage, usageGuideLine, type AssetUsage } from '#shared/asset-usage'

/**
 * Składanie DESIGN.md („Style Reference”) z ustrukturyzowanego `DesignSpec`.
 *
 * Kod — nie model — generuje: tabele tokenów, blok `:root` i `@theme`
 * (zawsze spójne z tabelami), oznaczenia założeń (†) oraz sekcję Sources
 * z mapowaniem asset → sekcje. Czysty moduł, testowany unitowo.
 */

export interface SourceAsset {
  id: number
  filename: string
  kind: string
  userNote: string | null
  /** Rola i aspekty ustawione przez użytkownika (brak = AI decyduje). */
  usage?: AssetUsage
}

export interface RenderMeta {
  boardTitle: string
  version: number
  generatedAt: string
  /** White-label: nazwa agencji zamiast „canvai” w nagłówku dokumentu. */
  preparedBy?: string | null
}

export interface SourceRow {
  assetId: number
  filename: string
  kind: string
  sections: string[]
}

export const ASSUMED = '†'
const REF_PATTERN = /\[A(\d+)\]/g

export function findAssetRefs(markdown: string): number[] {
  const ids = new Set<number>()
  for (const match of markdown.matchAll(REF_PATTERN)) ids.add(Number(match[1]))
  return [...ids]
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—'
}

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function refs(sources: number[]): string {
  return sources.map((id) => `[A${id}]`).join('')
}

function sourceLabel(sources: number[], assumed: boolean, confirmed = false): string {
  if (confirmed) return sources.length ? `${refs(sources)} · confirmed` : 'confirmed by client'
  if (sources.length) return refs(sources)
  return assumed ? `assumed ${ASSUMED}` : '—'
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '------').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${inline(i)}`).join('\n')
}

function headerLine(value: string): string {
  return (
    value
      .replace(/[\r\n#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'Untitled'
  )
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** `--text-body` → `--leading-body` */
function leadingToken(textToken: string): string {
  return `--leading-${textToken.replace(/^--(text-)?/, '')}`
}

function fontStack(name: string, substitute: string): string {
  const quoted = /[\s\d-]/.test(name) ? `'${name.replace(/'/g, '')}'` : name
  return `${quoted}, ${substitute || 'ui-sans-serif, system-ui, sans-serif'}`
}

function withPrefix(tokenName: string, prefix: string): string {
  return tokenName.startsWith(`--${prefix}-`)
    ? tokenName
    : `--${prefix}-${tokenName.replace(/^--/, '')}`
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'thin',
  200: 'extralight',
  300: 'light',
  400: 'regular',
  500: 'medium',
  600: 'semibold',
  700: 'bold',
  800: 'extrabold',
  900: 'black',
}

// ---------------------------------------------------------------------------
// Quick Start
// ---------------------------------------------------------------------------

function block(open: string, groups: [string, [string, string][]][]): string {
  const lines = [open]
  for (const [title, entries] of groups) {
    if (!entries.length) continue
    if (lines.length > 1) lines.push('')
    lines.push(`  /* ${title} */`)
    for (const [k, v] of entries) lines.push(`  ${k}: ${v};`)
  }
  lines.push('}')
  return lines.join('\n')
}

function layoutEntries(spec: DesignSpec): [string, string][] {
  return (
    [
      ['--page-max-width', spec.layout.pageMaxWidth],
      ['--section-gap', spec.layout.sectionGap],
      ['--card-padding', spec.layout.cardPadding],
      ['--element-gap', spec.layout.elementGap],
    ] as [string, string][]
  ).filter(([, v]) => v)
}

export function renderCssVariables(spec: DesignSpec): string {
  const weights = [...new Set(spec.typography.families.flatMap((f) => f.weights))].sort(
    (a, b) => a - b
  )
  return block(':root {', [
    ['Colors', spec.colors.map((c) => [c.token, c.hex])],
    [
      'Typography — Font Families',
      spec.typography.families.map((f) => [f.token, fontStack(f.name, f.substitute)]),
    ],
    [
      'Typography — Scale',
      spec.typography.scale.flatMap((r): [string, string][] =>
        r.lineHeight === '—'
          ? [[r.token, r.size]]
          : [
              [r.token, r.size],
              [leadingToken(r.token), r.lineHeight],
            ]
      ),
    ],
    [
      'Typography — Weights',
      weights.map((w) => [`--font-weight-${WEIGHT_NAMES[w] ?? w}`, String(w)]),
    ],
    [
      'Spacing',
      [
        ['--spacing-unit', spec.spacing.baseUnit],
        ...spec.spacing.scale.map((s): [string, string] => [`--spacing-${slug(s.name)}`, s.value]),
      ],
    ],
    ['Layout', layoutEntries(spec)],
    ['Border Radius', spec.radii.map((r) => [`--radius-${slug(r.name)}`, r.value])],
    ['Shadows', spec.shadows.map((s) => [`--shadow-${slug(s.name)}`, s.value])],
    ['Surfaces', spec.surfaces.map((s) => [`--surface-${slug(s.name)}`, s.value])],
  ])
}

export function renderTailwindTheme(spec: DesignSpec): string {
  return block('@theme {', [
    ['Colors', spec.colors.map((c) => [withPrefix(c.token, 'color'), c.hex])],
    [
      'Typography',
      spec.typography.families.map((f) => [
        withPrefix(f.token, 'font'),
        fontStack(f.name, f.substitute),
      ]),
    ],
    [
      'Typography — Scale',
      spec.typography.scale.flatMap((r): [string, string][] => {
        const t = withPrefix(r.token, 'text')
        return r.lineHeight === '—'
          ? [[t, r.size]]
          : [
              [t, r.size],
              [`${t}--line-height`, r.lineHeight],
            ]
      }),
    ],
    ['Spacing', spec.spacing.scale.map((s) => [`--spacing-${slug(s.name)}`, s.value])],
    ['Border Radius', spec.radii.map((r) => [`--radius-${slug(r.name)}`, r.value])],
    ['Shadows', spec.shadows.map((s) => [`--shadow-${slug(s.name)}`, s.value])],
  ])
}

// ---------------------------------------------------------------------------
// Dokument
// ---------------------------------------------------------------------------

export function buildSources(spec: DesignSpec, assets: SourceAsset[]): SourceRow[] {
  const refsMap = specReferences(spec)
  return assets.map((a) => ({
    assetId: a.id,
    filename: a.filename,
    kind: a.kind,
    sections: [...(refsMap.get(a.id) ?? [])],
  }))
}

export function renderDesignMd(
  spec: DesignSpec,
  assets: SourceAsset[],
  meta: RenderMeta
): { markdown: string; sources: SourceRow[] } {
  const sources = buildSources(spec, assets)
  const out: string[] = []
  const section = (title: string, ...parts: string[]) => {
    const body = parts
      .filter((p) => p && p.trim())
      .join('\n\n')
      .trim()
    if (body) out.push(`## ${title}\n\n${body}`)
  }

  // Nagłówek
  out.push(
    [
      `# ${headerLine(spec.name)} — Style Reference`,
      spec.tagline ? `> ${inline(spec.tagline)}` : '',
      `**Theme:** ${spec.theme}`,
      `${meta.preparedBy ? `Prepared by ${headerLine(meta.preparedBy)}` : 'Generated by canvai'} from the board „${headerLine(meta.boardTitle)}” — version ${meta.version}, ${meta.generatedAt}. Every token and component cites the board assets it comes from ([A<id>], see Sources). Values marked ${ASSUMED} are sensible defaults not shown in the materials — confirm them (see Open Questions).`,
      spec.overview,
    ]
      .filter(Boolean)
      .join('\n\n')
  )

  // Jak czytać referencje: z czego wzięto kolory, fonty, układ — i czego unikać.
  const guided = assets.filter((a) => !isDefaultUsage(a.usage))
  if (guided.length) {
    section(
      'How to Use the References',
      'The client marked what each material is for. Follow it when building UI: take from a reference only the aspects listed for it.',
      bullets(
        guided.map(
          (a) => `[A${a.id}] ${headerLine(a.filename).slice(0, 80)} — ${usageGuideLine(a.usage!)}`
        )
      )
    )
  }

  // Kolory
  section(
    'Tokens — Colors',
    table(
      ['Name', 'Value', 'Token', 'Role', 'Source'],
      spec.colors.map((c) => [
        `${c.name}${c.assumed ? ` ${ASSUMED}` : ''}`,
        `\`${c.hex}\``,
        `\`${c.token}\``,
        c.role,
        sourceLabel(c.sources, c.assumed, c.confirmed),
      ])
    )
  )

  // Typografia
  section(
    'Tokens — Typography',
    ...spec.typography.families.map((f) =>
      [
        `### ${f.name}${f.assumed ? ` ${ASSUMED}` : ''} — ${inline(f.role) || 'type family'} · \`${f.token}\``,
        f.substitute ? `- **Substitute:** ${f.substitute}` : '',
        f.weights.length ? `- **Weights:** ${f.weights.join(', ')}` : '',
        f.sizes.length ? `- **Sizes:** ${f.sizes.join(', ')}` : '',
        f.lineHeights.length ? `- **Line height:** ${f.lineHeights.join(', ')}` : '',
        `- **Source:** ${sourceLabel(f.sources, f.assumed, f.confirmed)}`,
      ]
        .filter(Boolean)
        .join('\n')
    ),
    spec.typography.scale.length
      ? `### Type Scale\n\n${table(
          ['Role', 'Family', 'Weight', 'Size', 'Line Height', 'Letter Spacing', 'Token'],
          spec.typography.scale.map((r) => [
            r.role,
            r.family,
            r.weight,
            r.size,
            r.lineHeight,
            r.letterSpacing,
            `\`${r.token}\``,
          ])
        )}`
      : ''
  )

  // Odstępy i kształty
  const layoutBullets = [
    spec.layout.pageMaxWidth ? `**Page max-width:** ${spec.layout.pageMaxWidth}` : '',
    spec.layout.sectionGap ? `**Section gap:** ${spec.layout.sectionGap}` : '',
    spec.layout.cardPadding ? `**Card padding:** ${spec.layout.cardPadding}` : '',
    spec.layout.elementGap ? `**Element gap:** ${spec.layout.elementGap}` : '',
  ].filter(Boolean)
  section(
    'Tokens — Spacing & Shapes',
    `**Base unit:** ${spec.spacing.baseUnit}${spec.spacing.assumed ? ` ${ASSUMED}` : ''}`,
    `**Density:** ${spec.spacing.density}`,
    spec.spacing.scale.length
      ? `### Spacing Scale\n\n${table(
          ['Name', 'Value', 'Token'],
          spec.spacing.scale.map((s) => [s.name, s.value, `\`--spacing-${slug(s.name)}\``])
        )}`
      : '',
    spec.radii.length
      ? `### Border Radius\n\n${table(
          ['Element', 'Value'],
          spec.radii.map((r) => [r.name, r.value])
        )}`
      : '',
    spec.shadows.length
      ? `### Shadows\n\n${table(
          ['Name', 'Value', 'Token'],
          spec.shadows.map((s) => [s.name, `\`${s.value}\``, `\`--shadow-${slug(s.name)}\``])
        )}`
      : '',
    layoutBullets.length ? `### Layout\n\n${bullets(layoutBullets)}` : ''
  )

  // Komponenty
  section(
    'Components',
    ...spec.components.map((c) =>
      [
        `### ${c.name}${c.assumed ? ` ${ASSUMED}` : ''}`,
        c.role ? `**Role:** ${inline(c.role)}` : '',
        c.description,
        c.states.length ? bullets(c.states) : '',
        `*Source:* ${sourceLabel(c.sources, c.assumed)}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  )

  // Ekrany i przepływy (z układu tablicy)
  section(
    'Screens & Flows',
    ...spec.screens.map((s) =>
      [
        `### ${s.name}`,
        s.purpose,
        s.elements.length ? `- **Key elements:** ${s.elements.join(', ')}` : '',
        s.sources.length ? `*Source:* ${refs(s.sources)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    ),
    spec.flows.length ? `### Flows\n\n${bullets(spec.flows)}` : ''
  )

  section(
    'Voice & Microcopy',
    spec.voice.tone,
    spec.voice.examples
      .map((e) => {
        // Propozycje modelu odróżnione od tekstu z materiałów.
        const proposed = e.match(/^\s*proposed\s*:\s*(.+)$/i)
        return proposed ? `- „${inline(proposed[1])}” _(proposed)_` : `- „${inline(e)}”`
      })
      .join('\n')
  )

  section("Do's and Don'ts", `### Do\n${bullets(spec.dos)}`, `### Don't\n${bullets(spec.donts)}`)

  // Dostępność: kontrast par tekst/tło liczony przez kod (WCAG 2.x).
  const contrast = contrastChecks(spec)
  if (contrast.length) {
    const failing = contrast.filter((c) => c.ratio < 4.5)
    section(
      'Accessibility',
      'Text contrast checked against WCAG 2.2 (AA: 4.5:1 for body text, 3:1 for large text ≥ 24px or ≥ 18.7px bold). Every interactive element needs a visible focus indicator with at least 3:1 contrast.',
      table(
        ['Text', 'Background', 'Ratio', 'WCAG', 'Use instead'],
        contrast.map((c) => [
          `${c.text.name} \`${c.text.hex}\``,
          `${c.background.name} \`${c.background.hex}\``,
          `${c.ratio.toFixed(2)}:1`,
          c.level === 'fail' ? '⚠ fail' : c.level === 'AA-large' ? '⚠ large text only' : c.level,
          c.suggestion && c.suggestion !== c.text.hex ? `\`${c.suggestion}\`` : '—',
        ])
      ),
      failing.length
        ? `⚠ ${failing.length} pair(s) fail AA for body text — use the suggested shade for small text, or reserve the original color for large text and decoration.`
        : ''
    )
  }

  if (spec.surfaces.length) {
    section(
      'Surfaces',
      table(
        ['Level', 'Name', 'Value', 'Purpose'],
        [...spec.surfaces]
          .sort((a, b) => a.level - b.level)
          .map((s) => [String(s.level), s.name, `\`${s.value}\``, s.purpose])
      )
    )
  }
  section('Elevation', spec.elevation)
  section('Imagery', spec.imagery)
  section('Layout', spec.layout.description)

  const quick = spec.agentGuide.quickColors.length
    ? spec.agentGuide.quickColors
    : spec.colors.slice(0, 7).map((c) => ({ name: c.name, value: c.hex }))
  section(
    'Agent Prompt Guide',
    `Quick Color Reference:\n${quick.map((q) => `- ${inline(q.name)}: ${q.value}`).join('\n')}`,
    spec.agentGuide.componentPrompts.length
      ? `Example Component Prompts:\n\n${spec.agentGuide.componentPrompts
          .map((p, i) => `${i + 1}. ${inline(p)}`)
          .join('\n')}`
      : ''
  )

  if (spec.similarBrands.length) {
    section(
      'Similar Brands',
      spec.similarBrands
        .map((b) => `- **${b.name}**${b.reason ? ` — ${inline(b.reason)}` : ''}`)
        .join('\n')
    )
  }

  section(
    'Quick Start',
    `### CSS Custom Properties\n\n\`\`\`css\n${renderCssVariables(spec)}\n\`\`\``,
    `### Tailwind v4\n\n\`\`\`css\n${renderTailwindTheme(spec)}\n\`\`\``
  )

  // Otwarte pytania: z modelu + automatycznie z założeń.
  const assumedItems = [
    ...spec.colors.filter((c) => c.assumed).map((c) => `color „${c.name}” (${c.hex})`),
    ...spec.typography.families.filter((f) => f.assumed).map((f) => `font „${f.name}”`),
    ...spec.components.filter((c) => c.assumed).map((c) => `component „${c.name}”`),
    ...(spec.spacing.assumed ? [`spacing scale (base ${spec.spacing.baseUnit})`] : []),
  ]
  section(
    'Open Questions',
    bullets([
      ...spec.openQuestions,
      ...(assumedItems.length
        ? [`Confirm assumed values ${ASSUMED}: ${assumedItems.join(', ')}.`]
        : []),
    ])
  )

  section(
    'Sources',
    sources.length
      ? table(
          ['Asset', 'Name', 'Type', 'Role', 'Client note', 'Used in'],
          sources.map((s) => {
            const asset = assets.find((a) => a.id === s.assetId)
            return [
              `A${s.assetId}`,
              s.filename.slice(0, 120),
              s.kind,
              describeUsage(asset?.usage),
              asset?.userNote ? asset.userNote.slice(0, 160) : '—',
              s.sections.length ? s.sections.join(', ') : 'not used',
            ]
          })
        )
      : 'No assets on the board — the document is based on notes only.'
  )

  return { markdown: out.join('\n\n') + '\n', sources }
}
