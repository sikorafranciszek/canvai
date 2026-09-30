import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { handleWebhook, verifySignature, type WebhookPayload } from '#services/billing/lemonsqueezy'

/**
 * POST /webhooks/lemonsqueezy — zdarzenia płatności. Bez sesji i CSRF;
 * autentyczność gwarantuje podpis HMAC. Błąd obsługi → 500, żeby Lemon
 * Squeezy ponowił (obsługa jest idempotentna).
 */
export default class WebhooksController {
  async lemonsqueezy({ request, response }: HttpContext) {
    const raw = request.raw() ?? ''
    if (!verifySignature(raw, request.header('x-signature'))) {
      return response.status(401).json({ message: 'Invalid signature' })
    }

    let payload: WebhookPayload
    try {
      payload = JSON.parse(raw) as WebhookPayload
    } catch {
      return response.status(400).json({ message: 'Invalid JSON' })
    }
    if (!payload?.meta?.event_name || !payload?.data?.id) {
      return response.status(400).json({ message: 'Invalid payload' })
    }

    try {
      const outcome = await handleWebhook(payload)
      logger.info({ event: payload.meta.event_name, id: payload.data.id, outcome }, 'LS webhook')
      return response.json({ ok: true, outcome })
    } catch (error) {
      logger.error({ err: error, event: payload.meta.event_name }, 'LS webhook failed')
      return response.status(500).json({ message: 'Webhook processing failed' })
    }
  }
}
