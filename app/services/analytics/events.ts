import type { HttpContext } from '@adonisjs/core/http'
import { parseUserAgent, track, visitorId } from '#services/analytics/collector'
import { currentLocale } from '#services/i18n'

/**
 * Zdarzenie produktowe w kontekście żądania (użytkownik, urządzenie, język).
 * Dla zdarzeń bez żądania (webhooki, zadania w tle) — `track` z `userId`.
 */
export function trackFor(
  ctx: HttpContext,
  event: string,
  props: Record<string, unknown> = {},
  extra: { userId?: number | null; boardId?: number | null } = {}
) {
  try {
    const ua = ctx.request.header('user-agent')
    track(event, props, {
      userId: extra.userId ?? (ctx as any).auth?.user?.id ?? (ctx as any).apiUser?.id ?? null,
      visitorId: visitorId(ctx.request.ip(), ua),
      boardId: extra.boardId ?? null,
      path: ctx.request.url(),
      route: ctx.route?.pattern ?? '',
      device: parseUserAgent(ua),
      locale: currentLocale(),
    })
  } catch {
    // Analityka nigdy nie może przerwać akcji użytkownika.
  }
}

export { track }
