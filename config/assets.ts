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

/**
 * Obrazy rastrowe — jedyne pliki serwowane inline (bajty weryfikowane przez
 * sharp przy uploadzie). SVG i wszystko inne idzie jako załącznik z CSP sandbox.
 */
export const rasterMimes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * Pozostałe dozwolone pliki (kind: file): fonty marki i zwykły tekst.
 * Lista DOZWOLONYCH — każdy inny typ (np. text/xml, application/xml, *+xml,
 * pliki wykonywalne) jest odrzucany przy uploadzie.
 */
export const allowedFileMimes: readonly string[] = [
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'font/collection',
  'application/font-woff',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/vnd.ms-fontobject',
  'text/plain',
  'text/markdown',
  'text/csv',
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

/**
 * Wariant do analizy AI (dla SVG i gdy brak oryginału): dłuższy bok = limit
 * dostawcy (1300 px), więc obraz jest skalowany tylko raz (AI-7).
 */
export const analysis = {
  maxDimension: 1300,
  quality: 90,
} as const

/** Źródła assetów akceptowane przez API. */
export const assetSources = ['paste', 'drop', 'upload', 'url'] as const

export type AssetSource = (typeof assetSources)[number]

/** Limit rozmiaru w formacie czytelnym dla ludzi (do komunikatów błędów). */
export const maxUploadSizeHuman = '20mb'
