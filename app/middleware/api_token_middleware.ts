import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type User from '#models/user'
import { bearer, userForToken } from '#services/api_tokens'
import { entitlementsFor } from '#services/billing/plans'
import { t } from '#services/i18n'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    /** Użytkownik uwierzytelniony tokenem API (REST v1 / MCP). */
    apiUser?: User
  }
}

/**
 * Uwierzytelnianie tokenem `Authorization: Bearer cvai_…` (bez sesji i CSRF).
 * API i MCP są funkcją płatnych planów.
 */
export default class ApiTokenMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = await userForToken(bearer(ctx.request.header('authorization')))
    if (!user) {
      ctx.response.header('WWW-Authenticate', 'Bearer realm="canvai"')
      return ctx.response.status(401).json({ error: t('api.unauthorized') })
    }
    const { limits } = await entitlementsFor(user.id)
    if (!limits.api) {
      return ctx.response.status(403).json({ error: t('api.planRequired') })
    }
    ctx.apiUser = user
    return next()
  }
}
