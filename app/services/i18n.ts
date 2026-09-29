import { AsyncLocalStorage } from 'node:async_hooks'
import { createTranslator, DEFAULT_LOCALE, type Locale, type Params } from '#shared/i18n'
import { en, pl, type ServerMessageKey } from '#services/i18n_messages'

/**
 * Język bieżącego kontekstu wykonania. Ustawiany przez `LocaleMiddleware`
 * dla żądań HTTP i przez kolejkę (`runWithLocale`) dla zadań w tle — dzięki
 * temu komunikaty z serwisów (walidacja, AI, generacja) mówią językiem
 * użytkownika bez przekazywania `locale` przez każdą funkcję.
 */
const storage = new AsyncLocalStorage<Locale>()

export function currentLocale(): Locale {
  return storage.getStore() ?? DEFAULT_LOCALE
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn)
}

const translator = createTranslator({ pl, en })

/** Tłumaczenie w języku bieżącego kontekstu. */
export function t(key: ServerMessageKey, params?: Params): string {
  return translator.t(currentLocale(), key, params)
}

export type { ServerMessageKey }
