import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { isLocale, LOCALE_COOKIE, resolveLocale } from '#shared/i18n'
import { runWithLocale } from '#services/i18n'

/**
 * Ustala język żądania: `?lang=` (link ze strony canvai.dev) → cookie
 * `dc_locale` (wybór w UI) → `Accept-Language`
 * (polski → PL, inny → EN). Preferencję zapisaną w koncie nakłada później
 * `UserLocaleMiddleware` (po uwierzytelnieniu). Cookie jest zwykłe
 * (niepodpisane) — wartość i tak jest walidowana.
 */
export default class LocaleMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // `?lang=` z linków strony canvai.dev — wybór języka zapamiętujemy w cookie.
    const fromQuery = ctx.request.qs().lang
    if (isLocale(fromQuery)) {
      ctx.response.plainCookie(LOCALE_COOKIE, fromQuery, {
        encode: false,
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        maxAge: '1y',
      })
    }
    const locale = resolveLocale(
      isLocale(fromQuery) ? fromQuery : ctx.request.plainCookie(LOCALE_COOKIE, { encoded: false }),
      ctx.request.header('accept-language')
    )
    ctx.view?.share({ locale })
    return runWithLocale(locale, () => next())
  }
}
