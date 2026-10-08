/**
 * Wspólna podstawa i18n (serwer + klient). Czysty moduł.
 *
 * Język: preferencja zapisana w koncie → cookie `dc_locale` (wybór w UI) →
 * nagłówek `Accept-Language` (polski → PL, każdy inny język → EN) → polski,
 * gdy przeglądarka nie podała żadnego języka. Słowniki żyją osobno: `app/services/i18n_messages.ts` (serwer)
 * i `inertia/i18n/messages/<język>.ts` (UI, ładowane per język).
 */

export const LOCALES = ['pl', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'pl'
/** Nazwa unikalna dla aplikacji — cookies są wspólne dla hosta `localhost` niezależnie od portu. */
export const LOCALE_COOKIE = 'dc_locale'
/** Język dla przeglądarek, które nie preferują żadnego z obsługiwanych języków. */
export const FALLBACK_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = { pl: 'Polski', en: 'English' }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Pierwszy obsługiwany język z nagłówka `Accept-Language` (z uwzględnieniem wag q). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 }
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}

export function resolveLocale(cookie: unknown, acceptLanguage?: string | null): Locale {
  if (isLocale(cookie)) return cookie
  if (!acceptLanguage?.trim()) return DEFAULT_LOCALE
  // Przeglądarka po polsku → PL; w każdym innym języku → EN.
  return localeFromAcceptLanguage(acceptLanguage) ?? FALLBACK_LOCALE
}

export type Params = Record<string, string | number>

/** „Plik {name} jest za duży” + { name } → podstawienie. Brakujący parametr zostaje w klamrach. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  )
}

/**
 * Kategoria liczebnika wg CLDR: pl → one/few/many/other, en → one/other.
 * Słownik podaje formy pod kluczami `<klucz>.one|few|many|other`.
 */
export function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(locale).select(n)
}

type Dict = Record<string, string>

/** Tworzy funkcję tłumaczącą nad słownikami; brak klucza → klucz (widoczny w UI, łatwy do wyłapania). */
export function createTranslator<D extends Dict>(dicts: Record<Locale, D>) {
  function t(locale: Locale, key: keyof D & string, params?: Params): string {
    const template = dicts[locale]?.[key] ?? dicts[DEFAULT_LOCALE][key] ?? key
    return interpolate(template, params)
  }

  /** Odmiana: `tp(locale, 'count.materials', 5)` → „5 materiałów” / „5 materials”. */
  function tp(locale: Locale, base: string, n: number, params?: Params): string {
    const dict = dicts[locale] as Dict
    const category = pluralCategory(locale, n)
    const template =
      dict[`${base}.${category}`] ?? dict[`${base}.other`] ?? dict[`${base}.many`] ?? base
    return interpolate(template, { n, ...params })
  }

  return { t, tp }
}
