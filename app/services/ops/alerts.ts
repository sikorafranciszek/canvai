import logger from '@adonisjs/core/services/logger'
import { ops } from '#config/ops'
import { crm } from '#config/analytics'

/**
 * Alerty dla administratorów: błędy serwera (logi `error`/`fatal`), nieudane
 * generacje, przekroczone budżety AI, nieudane kopie zapasowe.
 *
 * Zdarzenia są agregowane po kluczu i wysyłane najwyżej raz na
 * `minIntervalMs` (mail do ADMIN_EMAILS + opcjonalny webhook Slack/Discord) —
 * awaria nie zasypie skrzynki setkami wiadomości.
 */

interface AlertItem {
  message: string
  count: number
  firstAt: number
  lastAt: number
}

interface AlertState {
  items: Map<string, AlertItem>
  lastSentAt: number
  sending: boolean
}

const g = globalThis as unknown as { __canvaiAlerts?: AlertState }
const state: AlertState = (g.__canvaiAlerts ??= { items: new Map(), lastSentAt: 0, sending: false })

/** Ostatnio wysłane paczki (do testów i podglądu w CRM). */
export const sentAlerts: { at: string; text: string }[] = []

export function raiseAlert(key: string, message: string) {
  const now = Date.now()
  const item = state.items.get(key)
  if (item) {
    item.count++
    item.lastAt = now
    return
  }
  if (state.items.size >= 50) return
  state.items.set(key, { message: message.slice(0, 600), count: 1, firstAt: now, lastAt: now })
}

export function pendingAlerts(): number {
  return state.items.size
}

export function resetAlerts() {
  state.items.clear()
  state.lastSentAt = 0
  sentAlerts.length = 0
}

function render(items: [string, AlertItem][]): string {
  const lines = items.map(([key, it]) => {
    const times = it.count > 1 ? ` (×${it.count}, last ${new Date(it.lastAt).toISOString()})` : ''
    return `• [${key}] ${it.message}${times}`
  })
  return [`canvai: ${items.length} alert(s)`, '', ...lines].join('\n')
}

/** Wysyła zebrane alerty (o ile minął odstęp albo `force`). */
export async function flushAlerts(force = false): Promise<boolean> {
  if (state.sending || state.items.size === 0) return false
  if (!force && Date.now() - state.lastSentAt < ops.alerts.minIntervalMs) return false
  state.sending = true
  const items = [...state.items.entries()]
  state.items.clear()
  state.lastSentAt = Date.now()
  const text = render(items)
  sentAlerts.unshift({ at: new Date().toISOString(), text })
  sentAlerts.splice(20)
  try {
    const jobs: Promise<unknown>[] = []
    if (ops.alerts.webhookUrl) {
      jobs.push(
        fetch(ops.alerts.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `text` — Slack, `content` — Discord.
          body: JSON.stringify({ text, content: text.slice(0, 1900) }),
          signal: AbortSignal.timeout(10_000),
        })
      )
    }
    if (ops.alerts.email && crm.adminEmails.length) {
      const { default: mail } = await import('@adonisjs/mail/services/main')
      jobs.push(
        mail.send((message) => {
          message.to(crm.adminEmails[0]).subject(`[canvai] ${items.length} alert(s)`).text(text)
          for (const cc of crm.adminEmails.slice(1)) message.cc(cc)
        })
      )
    }
    const results = await Promise.allSettled(jobs)
    for (const r of results) {
      // `warn`, nie `error` — błąd wysyłki alertu nie może wywołać kolejnego alertu.
      if (r.status === 'rejected') logger.warn({ err: r.reason }, 'alert delivery failed')
    }
    return true
  } finally {
    state.sending = false
  }
}
