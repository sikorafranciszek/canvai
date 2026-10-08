/**
 * i18n UI: bieżący język w store (zmiana bez przeładowania strony), hook
 * `useT()` dla komponentów i `translate()` dla kodu poza Reactem (store'y,
 * klient API, toasty).
 */
import { useCallback } from 'react'
import { create } from 'zustand'
import {
  createTranslator,
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
  type Params,
} from '@shared/i18n'
import { pl, type MessageKey } from '~/i18n/messages/pl'

type Messages = Record<MessageKey, string>

/**
 * Słowniki per język (ARC-3): polski w paczce, angielski ładowany na żądanie.
 * Do czasu załadowania brakujący język korzysta z polskiego.
 */
const dictionaries: Record<Locale, Messages> = { pl, en: pl }
const loaded = new Set<Locale>(['pl'])
const translator = createTranslator(dictionaries)

const loaders: Record<Locale, () => Promise<Messages>> = {
  pl: async () => pl,
  en: async () => (await import('~/i18n/messages/en')).en,
}

/** Ładuje słownik języka (raz). */
export async function ensureLocale(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return
  dictionaries[locale] = await loaders[locale]()
  loaded.add(locale)
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export function initialLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE
  const lang = document.documentElement.lang
  return isLocale(lang) ? lang : DEFAULT_LOCALE
}

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: initialLocale(),
  setLocale(locale) {
    // Najpierw słownik, potem przełączenie — bez mignięcia tekstu w innym języku.
    void ensureLocale(locale).then(() => set({ locale }))
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    // Natychmiast (cookie dla kolejnych żądań) + trwale po stronie serwera:
    // serwer ustawia to samo cookie i zapisuje wybór w koncie zalogowanego.
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
    const xsrf = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1]
    void fetch('/locale', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}),
      },
      body: JSON.stringify({ locale }),
    }).catch(() => {})
  },
}))

/** Tłumaczenie poza Reactem — w bieżącym języku. */
export function translate(key: MessageKey, params?: Params): string {
  return translator.t(useLocaleStore.getState().locale, key, params)
}

export function translatePlural(base: string, n: number, params?: Params): string {
  return translator.tp(useLocaleStore.getState().locale, base, n, params)
}

/** Hook: `t(key, params)`, `tp(base, n)` i bieżący `locale`; rerender po zmianie języka. */
export function useT() {
  const locale = useLocaleStore((s) => s.locale)
  const t = useCallback(
    (key: MessageKey, params?: Params) => translator.t(locale, key, params),
    [locale]
  )
  const tp = useCallback(
    (base: string, n: number, params?: Params) => translator.tp(locale, base, n, params),
    [locale]
  )
  return { t, tp, locale }
}

export type { MessageKey }
