import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { crm } from '#config/analytics'
import {
  parseUserAgent,
  refererHost,
  track,
  trackRequest,
  visitorId,
} from '#services/analytics/collector'
import { currentLocale } from '#services/i18n'

const SKIP = new Set(['/health'])

/**
 * Każde żądanie → tabela `requests` (trasa, status, czas, urządzenie).
 * Wyświetlenie strony aplikacji (GET HTML/Inertia 2xx) → zdarzenie `page_view`.
 * Bez cookies: użytkownik po id konta, anonimowy po dziennym `visitor_id`.
 */
export default class AnalyticsMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { request, response } = ctx
    const path = request.url()
    if (SKIP.has(path)) return next()

    const started = process.hrtime.bigint()
    let failed = false
    try {
      await next()
    } catch (error) {
      failed = true
      throw error
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6
      const ua = request.header('user-agent')
      const device = parseUserAgent(ua)
      const vid = visitorId(request.ip(), ua)
      const userId = (ctx as any).auth?.user?.id ?? (ctx as any).apiUser?.id ?? null
      const route = ctx.route?.pattern ?? ''
      const host = request.hostname() ?? ''
      const status = failed && response.getStatus() < 400 ? 500 : response.getStatus()

      trackRequest({
        requestId: request.id() ?? randomUUID(),
        method: request.method(),
        route,
        path,
        status,
        durationMs,
        userId,
        visitorId: vid,
        device,
        host,
      })

      const isPage =
        request.method() === 'GET' &&
        status < 400 &&
        !path.startsWith('/api/') &&
        (request.header('x-inertia') === 'true' ||
          (request.header('accept') ?? '').includes('text/html')) &&
        device.device !== 'bot' &&
        host !== crm.host
      if (isPage) {
        const qs = request.qs()
        track(
          'page_view',
          {},
          {
            userId,
            visitorId: vid,
            path,
            route,
            referrerHost: refererHost(request.header('referer'), host),
            utm: { source: qs.utm_source, medium: qs.utm_medium, campaign: qs.utm_campaign },
            device,
            locale: currentLocale(),
          }
        )
      }
    }
  }
}
