/** Formatowanie dat i liczb dla UI (pl-PL). */

const rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** „5 min temu”, „wczoraj”, „2 tygodnie temu”. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'przed chwilą'
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Polska odmiana: 1 asset, 2 assety, 5 assetów. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** Komunikaty frameworka (np. auth) po polsku. */
const FLASH_TRANSLATIONS: Record<string, string> = {
  'Invalid user credentials': 'Nieprawidłowy e-mail lub hasło',
}

export function translateFlash(message: string): string {
  return FLASH_TRANSLATIONS[message] ?? message
}
