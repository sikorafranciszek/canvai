/** Formatowanie dat i liczb dla UI — w bieżącym języku interfejsu. */
import { translate, useLocaleStore } from '~/i18n'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const INTL_LOCALE = { pl: 'pl-PL', en: 'en-GB' } as const

function locale() {
  return useLocaleStore.getState().locale
}

/** „5 min temu” / „5 minutes ago”, „wczoraj” / „yesterday”. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return translate('time.justNow')
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(INTL_LOCALE[locale()], { dateStyle: 'medium', timeStyle: 'short' })
}

/** Komunikaty frameworka (np. auth) w języku UI. */
const FLASH_KEYS = {
  'Invalid user credentials': 'auth.login.invalid',
  'portal.sent': 'portal.flash.sent',
  'portal.approvedThanks': 'portal.flash.approved',
  'portal.changesThanks': 'portal.flash.changes',
} as const

export function translateFlash(message: string): string {
  const key = FLASH_KEYS[message as keyof typeof FLASH_KEYS]
  return key ? translate(key) : message
}
