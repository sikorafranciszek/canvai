import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { LOCALE_COOKIE, resolveLocale } from '#shared/i18n'
import { runWithLocale } from '#services/i18n'

/**
 * Ustala język żądania: cookie `dc_locale` (wybór w UI) → `Accept-Language`
 * (polski → PL, inny → EN). Preferencję zapisaną w koncie nakłada później
 * `UserLocaleMiddleware` (po uwierzytelnieniu). Cookie jest zwykłe
 * (niepodpisane) — wartość i tak jest walidowana.
 */
export default class LocaleMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const locale = resolveLocale(
      ctx.request.plainCookie(LOCALE_COOKIE, { encoded: false }),
      ctx.request.header('accept-language')
    )
    ctx.view?.share({ locale })
    return runWithLocale(locale, () => next())
  }
}
