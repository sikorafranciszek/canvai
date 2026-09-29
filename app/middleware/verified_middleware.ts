import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { t } from '#services/i18n'

/**
 * Wymaga potwierdzonego adresu e-mail. Strony → przekierowanie na ekran
 * weryfikacji; API → 403 JSON (klient pokaże komunikat). Stosować po `auth`.
 */
export default class VerifiedMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    if (user && !user.emailVerifiedAt) {
      if (ctx.request.url().startsWith('/api/')) {
        return ctx.response
          .status(403)
          .json({ message: t('account.emailNotVerified'), code: 'E_EMAIL_NOT_VERIFIED' })
      }
      return ctx.response.redirect().toPath('/verify-email')
    }
    return next()
  }
}
