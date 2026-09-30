import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { isAdmin } from '#services/crm/admin'

/**
 * Panel CRM: tylko administratorzy (ADMIN_EMAILS). Nie-admin jest wylogowywany
 * z domeny CRM i trafia na ekran logowania. Strony CRM nie są indeksowane.
 */
export default class CrmAdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { guest?: boolean } = {}) {
    ctx.response.header('X-Robots-Tag', 'noindex, nofollow')
    ctx.response.header('Cache-Control', 'private, no-store')
    if (options.guest) return next()

    await ctx.auth.check()
    const user = ctx.auth.user
    if (!isAdmin(user)) {
      if (user) await ctx.auth.use('web').logout()
      if (ctx.request.accepts(['html', 'json']) === 'json' && !ctx.request.header('x-inertia')) {
        return ctx.response.status(403).json({ message: 'Forbidden' })
      }
      return ctx.response.redirect().toPath('/login')
    }
    return next()
  }
}
