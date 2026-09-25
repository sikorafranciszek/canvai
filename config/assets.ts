/**
 * Konfiguracja przetwarzania assetów (upload, miniatury, klasyfikacja).
 * Limity i rozmiary są tutaj, a nie w kontrolerze — da się je podmienić bez
 * zmian w logice.
 */

/** Maksymalny rozmiar pojedynczego pliku w bajtach (domyślnie 20 MB). */
export const maxUploadSizeBytes = 20 * 1024 * 1024

/** Typy MIME klasyfikowane jako obrazy (kind: image). */
export const imageMimes: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]

/** Typy MIME klasyfikowane jako PDF (kind: pdf). */
export const pdfMimes: readonly string[] = ['application/pdf']

/**
 * Typy MIME zawsze odrzucane — nawet jako "zwykły plik". To wektory XSS
 * (serwowanie inline) lub pliki wykonywalne, których nie chcemy przyjmować.
 */
export const dangerousMimes: readonly string[] = [
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/x-server-parsed-html',
]

/** Miniatura: dłuższy bok maks. 512 px, format webp. */
export const thumbnail = {
  maxDimension: 512,
  quality: 80,
} as const

/** Wariant do analizy AI: dłuższy bok maks. 1568 px (oszczędza koszt w M3). */
export const analysis = {
  maxDimension: 1568,
  quality: 90,
} as const

/** Źródła assetów akceptowane przez API. */
export const assetSources = ['paste', 'drop', 'upload', 'url'] as const

export type AssetSource = (typeof assetSources)[number]

/** Limit rozmiaru w formacie czytelnym dla ludzi (do komunikatów błędów). */
export const maxUploadSizeHuman = '20mb'
