/**
 * Typy warstwy AI (M3). Wspólne dla dostawców (`deepseek`, `mock`), pipeline'u
 * i testów. Dostawca dostaje ustrukturyzowane wejście i zwraca zwalidowane
 * struktury — nigdy surowy tekst do dalszego parsowania.
 */

/** Rodzaje materiału rozpoznawane w etapie 1. */
export const ASSET_ROLES = [
  'screen',
  'component',
  'logo',
  'moodboard',
  'diagram',
  'photo',
  'illustration',
  'document',
  'link',
  'other',
] as const

export type AssetRole = (typeof ASSET_ROLES)[number]

export interface PaletteColor {
  /** `#rrggbb`, małe litery. */
  hex: string
  /** Rola koloru, np. „primary”, „background”, „text”. */
  role?: string
}

export interface TypographySample {
  usage: string
  family?: string
  size?: string
  weight?: string
}

/** Wynik etapu 1 — opis jednego assetu. */
export interface AssetAnalysisData {
  role: AssetRole
  summary: string
  ocrText: string
  palette: PaletteColor[]
  typography: TypographySample[]
  components: string[]
  layoutPatterns: string[]
  tags: string[]
}

/** Wejście etapu 1. Treść jest niezaufana (nazwa pliku, OCR, metadane linku). */
export interface AnalyzeAssetInput {
  assetId: number
  kind: 'image' | 'pdf' | 'link' | 'text' | 'file'
  filename: string
  mime: string | null
  width: number | null
  height: number | null
  linkMeta: { title?: string; description?: string } | null
  /** Obraz przygotowany pod limity dostawcy (wariant `analysis`), jeśli jest. */
  image: { buffer: Buffer; mime: string } | null
}

/** Klucze siedmiu sekcji pisanych przez model (sekcję 8 składa kod). */
export const SECTION_KEYS = [
  'overview',
  'screens',
  'components',
  'tokens',
  'layout',
  'content',
  'openQuestions',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_TITLES: Record<SectionKey | 'sources', string> = {
  overview: '1. Przegląd produktu',
  screens: '2. Ekrany i przepływy',
  components: '3. Inwentarz komponentów',
  tokens: '4. Tokeny wizualne',
  layout: '5. Wzorce layoutu i interakcji',
  content: '6. Treść i mikrocopy',
  openQuestions: '7. Otwarte pytania i luki',
  sources: '8. Źródła',
}

/** Wynik etapu 2 — treść markdown siedmiu sekcji. */
export type ComposedSections = Record<SectionKey, string>

export interface ComposeAssetInput {
  id: number
  filename: string
  kind: string
  userNote: string | null
  onCanvas: boolean
  analysis: AssetAnalysisData
}

export interface ComposeInput {
  boardTitle: string
  assets: ComposeAssetInput[]
  /** Struktura płótna (ramki, strzałki, notatki) — patrz `board_context.ts`. */
  context: import('#services/design/board_context').BoardContext
  /** Błędy poprzedniej próby — dostawca może je wykorzystać przy ponowieniu. */
  previousErrors?: string[]
}

export interface ProviderUsage {
  tokensIn: number
  tokensOut: number
}

export interface ProviderResult<T> {
  data: T
  model: string
  usage: ProviderUsage
}

export interface AiProvider {
  readonly name: string
  readonly analysisModel: string
  readonly compositionModel: string
  readonly vision: boolean
  analyzeAsset(input: AnalyzeAssetInput): Promise<ProviderResult<AssetAnalysisData>>
  composeDocument(input: ComposeInput): Promise<ProviderResult<ComposedSections>>
}

/**
 * Błąd dostawcy z informacją, czy warto ponowić. Komunikat trafia do
 * użytkownika, więc jest po polsku i nie zawiera sekretów.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

/** Odpowiedź modelu nie spełnia schematu — błąd ponawialny. */
export class InvalidModelOutputError extends AiProviderError {
  constructor(message: string) {
    super(message, true)
    this.name = 'InvalidModelOutputError'
  }
}
