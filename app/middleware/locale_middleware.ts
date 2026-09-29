import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { LOCALE_COOKIE, resolveLocale } from '#shared/i18n'
import { runWithLocale } from '#services/i18n'

/**
 * Ustala język żądania: cookie `locale` (wybór użytkownika w UI) →
 * `Accept-Language` → polski. Cookie jest zwykłe (nie podpisane), bo ustawia
 * je przełącznik języka w przeglądarce — wartość jest i tak walidowana.
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
