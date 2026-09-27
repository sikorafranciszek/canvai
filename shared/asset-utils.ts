/**
 * Narzędzia dla assetów: walidacja po stronie klienta + formatowanie.
 * Limity muszą być zgodne z `config/assets.ts` (serwer). Trzymane w `shared/`,
 * żeby testować jednostkowo (Japa, `#shared/asset-utils`).
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Typy MIME obsługiwane na płótnie (obraz + PDF). Reszta → czytelny komunikat. */
export const CANVAS_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
] as const

/** Typy zawsze odrzucane (wektory XSS / pliki wykonywalne). */
export const DANGEROUS_MIME_TYPES: readonly string[] = [
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
] as const

export type ClientFileRejectReason = 'too_large' | 'unsupported' | 'dangerous'

export type ClientFileVerdict =
  | { ok: true }
  | { ok: false; reason: ClientFileRejectReason }

export function isDangerousMime(mime: string): boolean {
  return DANGEROUS_MIME_TYPES.includes(mime)
}

export function isCanvasMime(mime: string): boolean {
  return CANVAS_MIME_TYPES.includes(mime)
}

/** Szybka walidacja przed wysłaniem (serwer i tak waliduje autorytatywnie). */
export function validateClientFile(file: { size: number; type: string }): ClientFileVerdict {
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too_large' }
  if (isDangerousMime(file.type)) return { ok: false, reason: 'dangerous' }
  if (!isCanvasMime(file.type)) return { ok: false, reason: 'unsupported' }
  return { ok: true }
}

/** Formatuje rozmiar w bajtach do czytelnej postaci (np. `1.4 MB`). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB'] as const
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

/** Czytelna etykieta rodzaju assetu. */
export function assetKindLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return 'Obraz'
    case 'pdf':
      return 'PDF'
    case 'link':
      return 'Link'
    case 'text':
      return 'Tekst'
    case 'file':
      return 'Plik'
    default:
      return kind
  }
}

/** Czy tekst wygląda na URL (http/https) — do rozpoznawania wklejonego linku. */
export function isHttpUrl(text: string): boolean {
  const trimmed = text.trim()
  return /^https?:\/\/\S+$/i.test(trimmed)
}
