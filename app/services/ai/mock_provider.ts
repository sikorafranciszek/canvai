import sharp from 'sharp'
import { validateAssetAnalysis, validateComposedSections } from '#services/ai/schemas'
import type {
  AiProvider,
  AnalyzeAssetInput,
  AssetAnalysisData,
  AssetRole,
  ComposeAssetInput,
  ComposeInput,
  ComposedSections,
  PaletteColor,
  ProviderResult,
} from '#services/ai/types'
import { buildAnalyzeUserText, buildComposeUserText } from '#services/design/prompts'

/**
 * Deterministyczny dostawca bez sieci. Używany w testach i zawsze, gdy nie ma
 * klucza API. Nie „udaje” modelu językowego — składa dokument z faktów, które
 * da się policzyć lokalnie (piksele obrazu, wymiary, nazwy, notatki, struktura
 * płótna), więc wynik jest ugruntowany i stabilny między uruchomieniami.
 *
 * Wyjście przechodzi przez te same walidatory co odpowiedź prawdziwego modelu.
 */

const PALETTE_ROLES = ['background', 'primary', 'text', 'accent', 'secondary', 'surface']

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Dominujące kolory obrazu (kwantyzacja do 32 poziomów, sort po częstości). */
export async function extractPalette(buffer: Buffer, max = 5): Promise<PaletteColor[]> {
  const { data, info } = await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize(24, 24, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Kubełki po 32 poziomy na kanał; kolor kubełka = średnia jego pikseli.
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
  if (/screen|screenshot|zrzut|page|strona|ekran|home|login|dashboard/.test(name)) return 'screen'
  if (input.width && input.height && input.width >= 800 && input.height >= 500) return 'screen'
  return 'other'
}

const ROLE_LABEL: Record<AssetRole, string> = {
  screen: 'Zrzut ekranu interfejsu',
  component: 'Fragment/komponent interfejsu',
  logo: 'Logo lub znak marki',
  moodboard: 'Moodboard/inspiracja wizualna',
  diagram: 'Diagram lub schemat przepływu',
  photo: 'Zdjęcie',
  illustration: 'Ilustracja',
  document: 'Dokument',
  link: 'Link do strony referencyjnej',
  other: 'Materiał wizualny',
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
      linkBits ? `Strona: ${linkBits.slice(0, 300)}.` : '',
      palette.length ? `Dominujące kolory: ${palette.map((p) => p.hex).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')

    const orientation =
      input.width && input.height
        ? input.width > input.height * 1.2
          ? 'układ poziomy (desktop)'
          : input.height > input.width * 1.2
            ? 'układ pionowy (mobile)'
            : 'układ zbliżony do kwadratu'
        : null

    const data = validateAssetAnalysis({
      role,
      summary,
      ocrText: '',
      palette,
      typography: [],
      components: [],
      layoutPatterns: orientation ? [orientation] : [],
      tags: [input.kind, role],
    })

    return { data, model: this.analysisModel, usage: { tokensIn: 0, tokensOut: 0 } }
  }

  async composeDocument(input: ComposeInput): Promise<ProviderResult<ComposedSections>> {
    this.lastComposePrompt = buildComposeUserText(input)
    const { assets, context } = input
    const ref = (a: ComposeAssetInput) => `[A${a.id}]`
    const refs = (list: ComposeAssetInput[]) => list.map(ref).join('')
    const byRole = (...roles: AssetRole[]) => assets.filter((a) => roles.includes(a.analysis.role))
    const notes = context.items.filter((it) => it.text && it.assetId === null)

    const screens = byRole('screen', 'diagram')
    const visuals = assets.filter((a) => a.analysis.palette.length > 0)
    const links = byRole('link')
    const withNotes = assets.filter((a) => a.userNote)

    // 1. Przegląd
    const overview = [
      `Tablica zawiera ${assets.length} materiał(y/ów) źródłowych ${refs(assets)}.`,
      withNotes.length
        ? `Opis od klienta:\n${withNotes.map((a) => `- ${ref(a)} ${oneLine(a.userNote!)}`).join('\n')}`
        : '',
      notes.length
        ? `Notatki na tablicy:\n${notes.map((n) => `- ${oneLine(n.text!)}`).join('\n')}`
        : '',
      links.length
        ? `Strony referencyjne: ${links.map((a) => `${ref(a)} ${a.filename}`).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    // 2. Ekrany i przepływy
    const screenLines = (screens.length ? screens : assets).map(
      (a) => `- **${oneLine(a.filename)}** ${ref(a)} — ${a.analysis.summary}`
    )
    const flowLines = context.flows.map((f) => `- ${f.from} → ${f.to}`)
    const frameLines = context.frames
      .filter((f) => f.contains.length > 0)
      .map((f) => `- Grupa ${f.ref}: ${f.contains.join(', ')}`)
    const screensMd = [
      screenLines.join('\n'),
      flowLines.length ? `**Przepływy (wg strzałek na tablicy):**\n${flowLines.join('\n')}` : '',
      frameLines.length ? `**Grupy (ramki na tablicy):**\n${frameLines.join('\n')}` : '',
      `**Kolejność czytania tablicy:** ${context.readingOrder.join(' → ') || '—'}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    // 3. Komponenty
    const componentSources = byRole('screen', 'component')
    const components = componentSources.length
      ? [
          `Komponenty należy wyprowadzić z materiałów ${refs(componentSources)}:`,
          '- **Przycisk** — wariant główny (wypełniony kolorem primary) i drugorzędny (obrys); stany: default, hover, focus (widoczny ring), disabled.',
          '- **Pole formularza** — etykieta nad polem, stan błędu z komunikatem pod polem.',
          '- **Karta** — tło surface, zaokrąglenie wg tokenu radius, cień wg tokenu shadow.',
          '- **Nawigacja** — zgodna z układem widocznym na zrzutach.',
        ].join('\n')
      : `Materiały ${refs(assets)} nie pokazują jednoznacznie komponentów UI — patrz sekcja 7.`

    // 4. Tokeny
    const colorRows: string[] = []
    const seen = new Set<string>()
    for (const a of visuals) {
      for (const c of a.analysis.palette) {
        if (seen.has(c.hex)) continue
        seen.add(c.hex)
        colorRows.push(
          `| color-${colorRows.length + 1} | \`${c.hex}\` | ${c.role ?? '—'} | ${ref(a)} |`
        )
      }
    }
    const darkest = [...seen].sort((x, y) => luminance(x) - luminance(y))[0]
    const lightest = [...seen].sort((x, y) => luminance(y) - luminance(x))[0]
    const tokens = [
      colorRows.length
        ? [
            '**Kolory** (wyznaczone z pikseli materiałów):',
            '',
            '| Token | Hex | Rola | Źródło |',
            '| --- | --- | --- | --- |',
            ...colorRows,
          ].join('\n')
        : `Brak materiałów rastrowych, z których da się odczytać paletę ${refs(assets)}.`,
      darkest && lightest && darkest !== lightest
        ? `Proponowane role: tekst \`${darkest}\`, tło \`${lightest}\`.`
        : '',
      '**Typografia, spacing, radius, cienie:** do potwierdzenia — patrz sekcja 7 (dostawca `mock` nie odczytuje fontów).',
    ]
      .filter(Boolean)
      .join('\n\n')

    // 5. Layout
    const layoutFacts = assets.flatMap((a) =>
      a.analysis.layoutPatterns.map((p) => `- ${p} ${ref(a)}`)
    )
    const layout = layoutFacts.length
      ? `Wzorce odczytane z proporcji materiałów:\n${layoutFacts.join('\n')}`
      : `Brak danych o układzie w materiałach ${refs(assets)} — patrz sekcja 7.`

    // 6. Treść
    const content = [
      withNotes.length || notes.length
        ? `Ton i słownictwo należy oprzeć na opisach klienta ${refs(withNotes.length ? withNotes : assets)}.`
        : `Materiały ${refs(assets)} nie zawierają tekstu, z którego da się wyprowadzić ton komunikacji.`,
      links.length
        ? `Tytuły stron referencyjnych: ${links.map((a) => `${ref(a)} „${oneLine(a.filename)}”`).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    // 7. Otwarte pytania
    const questions = [
      '- Jaka jest docelowa rodzina fontów i skala typograficzna? (domyślnie: systemowy sans-serif, skala 1.25)',
      '- Jaka skala odstępów? (domyślnie: 4/8/12/16/24/32/48 px)',
      '- Jakie zaokrąglenia i cienie? (domyślnie: radius 8px, cień 0 1px 3px rgba(0,0,0,.1))',
      screens.length === 0 ? '- Brak zrzutów ekranów — jakie widoki ma mieć produkt?' : '',
      context.flows.length === 0
        ? '- Brak strzałek na tablicy — jaka jest kolejność ekranów/przepływ użytkownika?'
        : '',
      withNotes.length === 0
        ? '- Brak notatek do assetów — co każdy materiał ma przedstawiać?'
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    const data = validateComposedSections({
      sections: {
        overview,
        screens: screensMd,
        components,
        tokens,
        layout,
        content,
        openQuestions: questions,
      },
    })
    return { data, model: this.compositionModel, usage: { tokensIn: 0, tokensOut: 0 } }
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}
