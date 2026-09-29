import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { isLocale } from '#shared/i18n'
import { runWithLocale } from '#services/i18n'

/**
 * Język zapisany w koncie ma pierwszeństwo przed cookie i przeglądarką.
 * Musi działać po `silent_auth` (wtedy znamy użytkownika); nadpisuje język
 * ustalony wcześniej przez `LocaleMiddleware`.
 */
export default class UserLocaleMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const preferred = ctx.auth.user?.locale
    if (!isLocale(preferred)) return next()
    ctx.view?.share({ locale: preferred })
    return runWithLocale(preferred, () => next())
  }
}
