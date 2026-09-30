import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { handleWebhook, verifyWebhook, type WebhookPayload } from '#services/billing/polar'

/**
 * POST /webhooks/polar — zdarzenia płatności Polar. Bez sesji i CSRF;
 * autentyczność gwarantuje podpis (Standard Webhooks). Błąd obsługi → 500,
 * żeby Polar ponowił (obsługa jest idempotentna).
 */
export default class WebhooksController {
  async polar({ request, response }: HttpContext) {
    const raw = request.raw() ?? ''
    const valid = verifyWebhook(raw, {
      id: request.header('webhook-id'),
      timestamp: request.header('webhook-timestamp'),
      signature: request.header('webhook-signature'),
    })
    if (!valid) return response.status(403).json({ message: 'Invalid signature' })

    let payload: WebhookPayload
    try {
      payload = JSON.parse(raw) as WebhookPayload
    } catch {
      return response.status(400).json({ message: 'Invalid JSON' })
    }
    if (typeof payload?.type !== 'string' || !payload.data) {
      return response.status(400).json({ message: 'Invalid payload' })
    }

    try {
      const outcome = await handleWebhook(payload)
      logger.info({ event: payload.type, id: payload.data.id, outcome }, 'Polar webhook')
      return response.status(202).json({ ok: true, outcome })
    } catch (error) {
      logger.error({ err: error, event: payload.type }, 'Polar webhook failed')
      return response.status(500).json({ message: 'Webhook processing failed' })
    }
  }
}
