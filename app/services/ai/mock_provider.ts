import sharp from 'sharp'
import { validateAssetAnalysis } from '#services/ai/schemas'
import { validateDesignSpec, type DesignSpec } from '#services/design/spec'
import type {
  AiProvider,
  AnalyzeAssetInput,
  AssetAnalysisData,
  AssetRole,
  ComposeAssetInput,
  ComposeInput,
  PaletteColor,
  PreviewInput,
  PreviewOutput,
  ProviderResult,
} from '#services/ai/types'
import { buildAnalyzeUserText, buildComposeUserText } from '#services/design/prompts'
import { renderPreviewTemplate } from '#services/design/preview_template'

/**
 * Deterministyczny dostawca bez sieci. Używany w testach i zawsze, gdy nie ma
 * klucza API. Nie „udaje” modelu językowego — składa specyfikację z faktów,
 * które da się policzyć lokalnie (piksele obrazów, wymiary, nazwy, notatki,
 * struktura płótna). Czego nie da się odczytać (fonty, skala odstępów), to
 * proponuje jako wartości domyślne z flagą `assumed`.
 *
 * Wyjście przechodzi przez te same walidatory co odpowiedź prawdziwego modelu.
 */

const PALETTE_ROLES = ['background', 'primary', 'text', 'accent', 'secondary', 'surface']

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/** Czytelna nazwa koloru (angielska, jak w tokenach dokumentu). */
export function colorName(hex: string): string {
  const { h, s, l } = hsl(hex)
  if (s < 0.12 || l > 0.95 || l < 0.08) {
    const warm = s >= 0.03 && (h < 70 || h > 330)
    const tone = warm ? 'Warm ' : s >= 0.03 && h > 180 && h < 260 ? 'Cool ' : ''
    if (l > 0.95) return `${tone}Paper`.trim()
    if (l > 0.82) return `${tone}Mist`
    if (l > 0.6) return `${tone}Ash`
    if (l > 0.35) return `${tone}Graphite`
    return `${tone}Ink`
  }
  const families: [number, string, string, string][] = [
    // [max hue, light, mid, dark]
    [15, 'Rose', 'Brick', 'Oxblood'],
    [45, 'Peach', 'Terracotta', 'Espresso'],
    [70, 'Butter', 'Ochre', 'Olive'],
    [165, 'Mint', 'Sage', 'Forest'],
    [200, 'Aqua', 'Teal', 'Deep Teal'],
    [250, 'Sky', 'Cobalt', 'Navy'],
    [290, 'Lavender', 'Violet', 'Indigo'],
    [345, 'Blush', 'Plum', 'Aubergine'],
    [360, 'Rose', 'Brick', 'Oxblood'],
  ]
  const [, light, mid, dark] = families.find(([max]) => h <= max) ?? families[0]
  return l > 0.72 ? light : l < 0.3 ? dark : mid
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Dominujące kolory obrazu (kubełki po 32 poziomy, średnia pikseli w kubełku). */
export async function extractPalette(buffer: Buffer, max = 5): Promise<PaletteColor[]> {
  const { data, info } = await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize(24, 24, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bucket.n++
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .map((bk) => ({ n: bk.n, hex: toHex(bk.r / bk.n, bk.g / bk.n, bk.b / bk.n) }))
    .sort((a, b) => b.n - a.n || a.hex.localeCompare(b.hex))
    .slice(0, max)
    .map(({ hex }, i) => ({ hex, role: PALETTE_ROLES[i] ?? 'accent' }))
}

function guessRole(input: AnalyzeAssetInput): AssetRole {
  const name = input.filename.toLowerCase()
  if (input.kind === 'link') return 'link'
  if (input.kind === 'pdf' || input.kind === 'file' || input.kind === 'text') return 'document'
  if (/logo|brand|znak/.test(name)) return 'logo'
  if (/mood|inspir/.test(name)) return 'moodboard'
  if (/diagram|flow|przep/.test(name)) return 'diagram'
  if (/button|btn|card|input|icon|component|komponent/.test(name)) return 'component'
  if (/screen|screenshot|zrzut|page|strona|ekran|home|login|dashboard|checkout/.test(name))
    return 'screen'
  if (input.width && input.height && input.width >= 800 && input.height >= 500) return 'screen'
  return 'other'
}

const ROLE_LABEL: Record<AssetRole, string> = {
  screen: 'Interface screenshot',
  component: 'UI component or fragment',
  logo: 'Logo or brand mark',
  moodboard: 'Moodboard / visual inspiration',
  diagram: 'Diagram or flow sketch',
  photo: 'Photograph',
  illustration: 'Illustration',
  document: 'Document',
  link: 'Reference website link',
  other: 'Visual material',
}

/** „home-screen_v2.png” → „Home Screen V2” */
function humanize(filename: string): string {
  const base = filename.replace(/^https?:\/\//, '').replace(/\.[a-z0-9]{2,4}$/i, '')
  const words = base
    .split(/[-_\s./]+/)
    .filter(Boolean)
    .slice(0, 5)
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Screen'
}

function oneLine(text: string, max = 300): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

interface PaletteEntry {
  hex: string
  sources: Set<number>
  weight: number
}

export class MockProvider implements AiProvider {
  readonly name = 'mock'
  readonly analysisModel = 'mock-text'
  readonly compositionModel = 'mock-text'
  readonly vision = false

  /** Ostatnie zbudowane prompty — do testów ogrodzenia niezaufanej treści. */
  lastAnalyzePrompt: string | null = null
  lastComposePrompt: string | null = null

  async analyzeAsset(input: AnalyzeAssetInput): Promise<ProviderResult<AssetAnalysisData>> {
    this.lastAnalyzePrompt = buildAnalyzeUserText(input)
    const role = guessRole(input)

    let palette: PaletteColor[] = []
    if (input.image) {
      try {
        palette = await extractPalette(input.image.buffer)
      } catch {
        palette = []
      }
    }

    const size = input.width && input.height ? ` (${input.width}×${input.height}px)` : ''
    const linkBits =
      input.kind === 'link'
        ? [input.linkMeta?.title, input.linkMeta?.description].filter(Boolean).join(' — ')
        : ''
    const summary = [
      `${ROLE_LABEL[role]}${size}.`,
      linkBits ? `Page: ${linkBits.slice(0, 300)}.` : '',
      palette.length ? `Dominant colors: ${palette.map((p) => p.hex).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')

    const orientation =
      input.width && input.height
        ? input.width > input.height * 1.2
          ? 'landscape layout (desktop)'
          : input.height > input.width * 1.2
            ? 'portrait layout (mobile)'
            : 'near-square composition'
        : null

    const lightBg = palette[0] ? luminance(palette[0].hex) > 0.6 : true
    const data = validateAssetAnalysis({
      role,
      summary,
      ocrText: '',
      palette,
      typography: [],
      components: [],
      layoutPatterns: orientation ? [orientation] : [],
      styleHints: [],
      mood: palette.length ? (lightBg ? 'light, airy' : 'dark, dense') : '',
      tags: [input.kind, role],
    })

    return { data, model: this.analysisModel, usage: { tokensIn: 0, tokensOut: 0 } }
  }

  async composePreview(input: PreviewInput): Promise<ProviderResult<PreviewOutput>> {
    return {
      data: { html: renderPreviewTemplate(input.spec) },
      model: this.compositionModel,
      usage: { tokensIn: 0, tokensOut: 0 },
    }
  }

  async composeDocument(input: ComposeInput): Promise<ProviderResult<DesignSpec>> {
    this.lastComposePrompt = buildComposeUserText(input)
    const spec = buildMockSpec(input)
    return {
      data: validateDesignSpec(spec),
      model: this.compositionModel,
      usage: { tokensIn: 0, tokensOut: 0 },
    }
  }
}

// ---------------------------------------------------------------------------
// Składanie specyfikacji (mock)
// ---------------------------------------------------------------------------

function buildMockSpec(input: ComposeInput): Record<string, unknown> {
  const { assets, context, boardTitle } = input
  const byRole = (...roles: AssetRole[]) => assets.filter((a) => roles.includes(a.analysis.role))
  const screens = byRole('screen', 'diagram')
  const components = byRole('component')
  const withNotes = assets.filter((a) => a.userNote?.trim())
  const canvasNotes = context.items.filter((it) => it.text && it.assetId === null)
  const desktop = assets.some((a) => a.analysis.layoutPatterns.some((p) => p.includes('desktop')))
  const mobile = assets.some((a) => a.analysis.layoutPatterns.some((p) => p.includes('mobile')))
  const src = (list: ComposeAssetInput[]) => list.map((a) => a.id)
  const refs = (list: ComposeAssetInput[]) => list.map((a) => `[A${a.id}]`).join('')

  // --- Paleta: scalenie podobnych kolorów ze wszystkich materiałów
  const entries: PaletteEntry[] = []
  for (const a of assets) {
    a.analysis.palette.forEach((c, i) => {
      const hit = entries.find((e) => distance(e.hex, c.hex) < 28)
      const w = 5 - Math.min(i, 4)
      if (hit) {
        hit.sources.add(a.id)
        hit.weight += w
      } else {
        entries.push({ hex: c.hex, sources: new Set([a.id]), weight: w })
      }
    })
  }
  entries.sort((x, y) => y.weight - x.weight || x.hex.localeCompare(y.hex))
  const top = entries.slice(0, 8)

  type C = {
    name: string
    hex: string
    token: string
    role: string
    sources: number[]
    assumed: boolean
  }
  const colors: C[] = []
  const used = new Set<string>()
  const addColor = (
    entry: PaletteEntry | number[] | null,
    hex: string,
    tokenName: string,
    role: string,
    assumed = false,
    preferredName?: string
  ) => {
    const base = preferredName ?? colorName(hex)
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base} ${i}`
    used.add(name)
    const sources = Array.isArray(entry) ? entry : entry ? [...entry.sources] : []
    colors.push({
      name,
      hex,
      token: `--color-${tokenName}`,
      role,
      sources: [...new Set(sources)].sort((a, b) => a - b),
      assumed,
    })
  }

  const byLum = [...top].sort((x, y) => luminance(y.hex) - luminance(x.hex))
  const lightest = byLum[0] ?? null
  const darkest = byLum.length > 1 ? byLum[byLum.length - 1] : null
  const canvasHex = lightest && luminance(lightest.hex) > 0.75 ? lightest.hex : '#faf8f5'
  const inkHex = darkest && luminance(darkest.hex) < 0.3 ? darkest.hex : '#27251e'
  const theme = lightest && luminance(lightest.hex) < 0.3 ? 'dark' : 'light'

  const canvasEntry = canvasHex === lightest?.hex ? lightest : null
  const inkEntry = inkHex === darkest?.hex ? darkest : null
  // Kolory pochodne (mieszanki canvas/ink) dziedziczą źródła kolorów bazowych.
  const derived = [...(canvasEntry?.sources ?? []), ...(inkEntry?.sources ?? [])]
  const derivedAssumed = derived.length === 0
  addColor(
    canvasEntry,
    canvasHex,
    'canvas',
    'Page canvas and base surface — the background every screen sits on',
    !canvasEntry
  )
  // Powierzchnia o krok od płótna: jaśniejsza, a przy prawie białym płótnie lekko przyciemniona.
  const surfaceHex =
    luminance(canvasHex) > 0.96 ? mix(canvasHex, inkHex, 0.035) : mix(canvasHex, '#ffffff', 0.5)
  addColor(
    derived,
    surfaceHex,
    'surface',
    'Surface for cards, panels and inputs — one tonal step away from the canvas (derived)',
    derivedAssumed,
    `Soft ${colorName(canvasHex).replace(/^(Warm|Cool) /, '')}`
  )
  addColor(inkEntry, inkHex, 'ink', 'Primary text, icons and the solid button fill', !inkEntry)
  addColor(
    derived,
    mix(inkHex, canvasHex, 0.45),
    'text-secondary',
    'Secondary text, helper labels and inactive navigation (derived: ink softened toward the canvas)',
    derivedAssumed
  )
  addColor(
    derived,
    mix(inkHex, canvasHex, 0.82),
    'border',
    'Hairline borders and dividers, 1px (derived)',
    derivedAssumed
  )

  const chromatic = top
    .filter((e) => e !== lightest && e !== darkest)
    .sort((x, y) => hsl(y.hex).s - hsl(x.hex).s)
  const accent = chromatic.find((e) => hsl(e.hex).s > 0.25) ?? null
  if (accent) {
    addColor(
      accent,
      accent.hex,
      'accent',
      'Brand accent — primary actions, active states and key highlights; use sparingly'
    )
  } else {
    addColor(
      null,
      '#016a71',
      'accent',
      'Accent for primary actions and active states (no saturated color found in the materials)',
      true
    )
  }
  for (const e of chromatic.filter((c) => c !== accent).slice(0, 3)) {
    addColor(
      e,
      e.hex,
      slug(colorName(e.hex)),
      'Supporting brand color observed in the materials — illustrations, tags, secondary highlights'
    )
  }
  addColor(null, '#b42318', 'danger', 'Errors and destructive actions', true)

  const accentColor = colors.find((c) => c.token === '--color-accent')!
  const c = (token: string) => colors.find((x) => x.token === `--color-${token}`)!
  const surface = c('surface')
  const border = c('border')
  const secondary = c('text-secondary')

  // --- Ekrany i przepływy
  const refName = new Map<string, string>()
  const screenSpecs = (screens.length ? screens : assets.filter((a) => a.analysis.role !== 'link'))
    .slice(0, 12)
    .map((a) => {
      const name = a.userNote?.trim() ? oneLine(a.userNote, 60) : humanize(a.filename)
      refName.set(`A${a.id}`, name)
      return {
        name,
        purpose: `${a.analysis.summary}${a.userNote ? ` Client note: „${oneLine(a.userNote)}”.` : ''}`,
        elements: [...a.analysis.components, ...a.analysis.layoutPatterns].slice(0, 8),
        sources: [a.id],
      }
    })
  const label = (ref: string) => {
    const known = refName.get(ref)
    if (known) return `${known} [${ref}]`
    const note = context.items.find((it) => it.ref === ref)?.text
    return note ? `„${oneLine(note, 40)}”` : ref
  }
  const flows = [
    ...context.flows.map((f) => `${label(f.from)} → ${label(f.to)}`),
    ...context.frames
      .filter((f) => f.contains.length > 1)
      .map((f) => `Grouped on the board: ${f.contains.map(label).join(', ')}`),
  ]

  // --- Typografia i kształty (założenia)
  const scale = [
    ['caption', '12px', '1.4', '500'],
    ['body-sm', '13px', '1.45', '400'],
    ['body', '15px', '1.55', '400'],
    ['body-lg', '17px', '1.5', '400'],
    ['h3', '20px', '1.35', '600'],
    ['h2', '26px', '1.25', '600'],
    ['h1', '34px', '1.15', '600'],
    ...(desktop ? [['display', '44px', '1.1', '600']] : []),
  ]
  const componentSources = src([...screens, ...components])
  const assumedComponents = componentSources.length === 0

  const overviewParts = [
    `${boardTitle} reads as a ${theme === 'light' ? 'light' : 'dark'}, ${accent ? 'brand-led' : 'restrained'} interface built from ${assets.length} client material(s) ${refs(assets)}.`,
    `The base is ${c('canvas').name} (${canvasHex}) with ${c('ink').name} (${inkHex}) text${accent ? `, and ${accentColor.name} (${accentColor.hex}) carries emphasis for actions and active states` : ''}.`,
    withNotes.length
      ? `Client intent: ${withNotes.map((a) => `„${oneLine(a.userNote!, 120)}” [A${a.id}]`).join('; ')}.`
      : '',
    canvasNotes.length
      ? `Board notes: ${canvasNotes.map((n) => `„${oneLine(n.text!, 120)}”`).join('; ')}.`
      : '',
    `Components stay flat with hairline ${border.name} borders and a single subtle shadow, so content — not chrome — leads.`,
  ]

  return {
    name: boardTitle,
    tagline: `${colorName(canvasHex).toLowerCase()} canvas, ${colorName(inkHex).toLowerCase()} type${accent ? `, one ${accentColor.name.toLowerCase()} accent` : ''}`,
    theme,
    overview: overviewParts.filter(Boolean).join(' '),
    colors,
    typography: {
      families: [
        {
          name: 'Inter',
          token: '--font-sans',
          substitute: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          weights: [400, 500, 600],
          sizes: scale.map((r) => r[1]),
          lineHeights: [...new Set(scale.map((r) => r[2]))],
          role: 'Primary UI and body typeface — the mock provider cannot read fonts from images, confirm the real family',
          sources: [],
          assumed: true,
        },
      ],
      scale: scale.map(([role, size, lineHeight, weight]) => ({
        role,
        family: 'Inter',
        weight,
        size,
        lineHeight,
        letterSpacing: role.startsWith('h') || role === 'display' ? '-0.01em' : '0',
        token: `--text-${role}`,
      })),
    },
    spacing: {
      baseUnit: '4px',
      density: mobile && !desktop ? 'compact' : 'comfortable',
      scale: ['4', '8', '12', '16', '24', '32', '48', '64'].map((n) => ({
        name: n,
        value: `${n}px`,
      })),
      assumed: true,
    },
    radii: [
      { element: 'buttons', value: '8px' },
      { element: 'inputs', value: '10px' },
      { element: 'cards', value: '14px' },
      { element: 'chips', value: '9999px' },
    ],
    shadows: [{ name: 'subtle', value: 'rgba(0, 0, 0, 0.08) 0px 1px 2px 0px' }],
    layout: {
      pageMaxWidth: desktop ? '1200px' : mobile ? '440px' : '960px',
      sectionGap: desktop ? '64px' : '32px',
      cardPadding: '20px',
      elementGap: '12px',
      description:
        [
          desktop
            ? 'Desktop-first layout with a centered content column; collapse to a single column below 768px.'
            : '',
          mobile
            ? 'Mobile screens are present — design touch targets of at least 44px and a bottom-reachable primary action.'
            : '',
          screens.length
            ? `Screen order follows the board: ${
                context.readingOrder
                  .filter((r) => refName.has(r))
                  .map(label)
                  .join(' → ') || screenSpecs.map((s) => s.name).join(' → ')
              }.`
            : '',
          context.frames.length
            ? `The board groups materials into ${context.frames.length} frame(s); keep those groups as sections or steps of the same flow.`
            : '',
        ]
          .filter(Boolean)
          .join(' ') || 'Single centered column with generous whitespace between sections.',
    },
    components: [
      {
        name: 'Primary Button',
        role: 'High-emphasis action (submit, buy, continue)',
        description: `${accentColor.name} (${accentColor.hex}) background, ${surface.name} (${surface.hex}) text, no border, 8px radius, 10px vertical / 16px horizontal padding, 15px weight 500. One per view.`,
        states: [
          `hover: darken the fill by ~8%`,
          `focus: 2px ${accentColor.hex} outline with 2px offset`,
          'disabled: 45% opacity, no pointer',
        ],
        sources: componentSources,
        assumed: assumedComponents,
      },
      {
        name: 'Secondary Button',
        role: 'Low-emphasis action (cancel, back, filters)',
        description: `Transparent background, ${c('ink').name} (${inkHex}) text, 1px ${border.name} (${border.hex}) border, 8px radius, 10px / 16px padding, 15px weight 400.`,
        states: [`hover: ${surface.hex} fill`, 'focus: accent outline', 'disabled: 45% opacity'],
        sources: componentSources,
        assumed: assumedComponents,
      },
      {
        name: 'Text Input',
        role: 'Form field',
        description: `${surface.name} (${surface.hex}) background, 1px ${border.name} border, 10px radius, 44px height, 14px horizontal padding, placeholder in ${secondary.name} (${secondary.hex}); label 13px weight 500 above the field.`,
        states: [
          `focus: ${accentColor.hex} border + soft ring`,
          `error: ${c('danger').hex} border with message below`,
        ],
        sources: [],
        assumed: true,
      },
      {
        name: 'Card',
        role: 'Content container',
        description: `${surface.name} (${surface.hex}) surface, 14px radius, 20px padding, subtle 1px shadow; title 17px weight 500 in ${c('ink').name}, body 15px in ${secondary.name}.`,
        states: ['hover (when interactive): hairline border in accent tint'],
        sources: componentSources,
        assumed: assumedComponents,
      },
      {
        name: 'Top Navigation',
        role: 'Primary navigation bar',
        description: `${c('canvas').name} background, 64px tall, logo on the left, links in ${secondary.name} 15px, active link in ${c('ink').name} with a 2px ${accentColor.name} underline.`,
        states: ['hover: link color to ink'],
        sources: src(byRole('logo', 'screen')),
        assumed: byRole('logo', 'screen').length === 0,
      },
      {
        name: 'Badge',
        role: 'Status or "new" marker',
        description: `${accentColor.name} background, white text, 9999px radius, 2px / 8px padding, 11px weight 500.`,
        states: [],
        sources: [],
        assumed: true,
      },
    ],
    screens: screenSpecs,
    flows,
    voice: {
      tone:
        withNotes.length || canvasNotes.length
          ? `Derive the voice from the client's own words: ${[...withNotes.map((a) => `„${oneLine(a.userNote!, 80)}”`), ...canvasNotes.map((n) => `„${oneLine(n.text!, 80)}”`)].join(', ')}. Keep copy short, concrete and in the client's language.`
          : 'No copy in the materials — use short, plain, action-first labels.',
      examples: [
        ...withNotes.map((a) => oneLine(a.userNote!, 80)),
        ...canvasNotes.map((n) => oneLine(n.text!, 80)),
      ].slice(0, 8),
    },
    dos: [
      `Use ${c('canvas').name} (${canvasHex}) as the page background and ${surface.name} (${surface.hex}) for raised surfaces.`,
      `Set body text in ${c('ink').name} (${inkHex}) and secondary text in ${secondary.name} (${secondary.hex}).`,
      `Reserve ${accentColor.name} (${accentColor.hex}) for primary actions, focus and active states.`,
      `Use 1px ${border.name} (${border.hex}) hairlines to separate content instead of heavy boxes.`,
      'Keep radii consistent: 8px buttons, 10px inputs, 14px cards, pill chips.',
      'Follow the 4px spacing grid (4, 8, 12, 16, 24, 32, 48, 64).',
    ],
    donts: [
      `Don't introduce accent colors beyond ${accentColor.name}${chromatic.length > 1 ? ' and the supporting brand colors' : ''}.`,
      "Don't use pure black text or pure white surfaces — stay within the palette.",
      "Don't stack shadows; one subtle shadow is the only elevation.",
      "Don't use more than one primary button per view.",
      "Don't go below 13px for any readable text.",
    ],
    surfaces: [
      { level: 0, name: 'Page Canvas', value: canvasHex, purpose: 'Full-viewport background' },
      { level: 1, name: 'Card Surface', value: surface.hex, purpose: 'Cards, panels, inputs' },
      {
        level: 2,
        name: 'Accent',
        value: accentColor.hex,
        purpose: 'Primary action and active state fill',
      },
      {
        level: 3,
        name: 'Ink Fill',
        value: inkHex,
        purpose: 'Solid dark fills and high-contrast elements',
      },
    ],
    elevation:
      'Flat by design: surfaces separate by tone and 1px hairlines. The only shadow is a subtle 1px shadow on cards and floating menus.',
    imagery: byRole('photo', 'illustration').length
      ? `Imagery from the materials ${refs(byRole('photo', 'illustration'))} sets the tone — reuse its crop, color grading and style.`
      : byRole('logo').length
        ? `The brand mark ${refs(byRole('logo'))} is the main graphic element; icons should be simple monochrome line glyphs in ${c('ink').name}.`
        : `No photography in the materials — rely on typography, spacing and simple monochrome line icons in ${c('ink').name}.`,
    agentGuide: {
      quickColors: [
        { label: 'text (primary)', value: inkHex },
        { label: 'text (secondary)', value: secondary.hex },
        { label: 'background', value: canvasHex },
        { label: 'surface', value: surface.hex },
        { label: 'border', value: border.hex },
        { label: 'accent / primary action', value: accentColor.hex },
      ],
      componentPrompts: [
        `Create a primary button: ${accentColor.hex} background, ${surface.hex} text, 8px radius, 10px 16px padding, Inter 15px weight 500; hover darkens 8%, focus shows a 2px ${accentColor.hex} outline.`,
        `Create a card: ${surface.hex} background, 14px radius, 20px padding, shadow rgba(0,0,0,0.08) 0 1px 2px; title Inter 17px/500 ${inkHex}, body 15px ${secondary.hex}.`,
        `Create a text input: ${surface.hex} background, 1px ${border.hex} border, 10px radius, 44px height; label 13px/500 above; focus border ${accentColor.hex}.`,
      ],
    },
    similarBrands: [],
    openQuestions: [
      'Which typeface does the brand use? Inter is a placeholder until confirmed.',
      'Confirm the spacing scale and radii against real screens.',
      ...(screens.length === 0
        ? ['No interface screenshots — which screens should the product have?']
        : []),
      ...(context.flows.length === 0
        ? ['No arrows on the board — what is the order of screens / the user flow?']
        : []),
      ...(withNotes.length === 0
        ? ['No notes on materials — what should each item represent?']
        : []),
      ...(accent ? [] : ['No saturated brand color found — confirm the accent color.']),
    ],
  }
}
