import type { DesignSpec } from '#services/design/spec'

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
  /** Obserwacje stylu: zaokrąglenia, cienie, obramowania, gęstość, odstępy. */
  styleHints: string[]
  /** Nastrój / charakter wizualny w kilku słowach. */
  mood: string
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

export interface ComposeAssetInput {
  id: number
  filename: string
  kind: string
  userNote: string | null
  onCanvas: boolean
  analysis: AssetAnalysisData
  /** Jak użyć materiału (rola i aspekty) — ustawione przez użytkownika. */
  usage?: import('#shared/asset-usage').AssetUsage
}

export type { DesignSpec } from '#services/design/spec'

export interface ComposeInput {
  boardTitle: string
  assets: ComposeAssetInput[]
  /** Struktura płótna (ramki, strzałki, notatki) — patrz `board_context.ts`. */
  context: import('#services/design/board_context').BoardContext
  /** Błędy poprzedniej próby — dostawca może je wykorzystać przy ponowieniu. */
  previousErrors?: string[]
  /** Tryb Pro reasoning — model rozumuje dłużej (droższy, dokładniejszy). */
  reasoning?: boolean
}

/** Podgląd UI: przykładowa strona HTML w stylu dokumentu. */
export interface PreviewInput {
  boardTitle: string
  designMd: string
  spec: import('#services/design/spec').DesignSpec
}

export interface PreviewOutput {
  html: string
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
  composeDocument(input: ComposeInput): Promise<ProviderResult<DesignSpec>>
  composePreview(input: PreviewInput): Promise<ProviderResult<PreviewOutput>>
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
