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
  /** Ile wystąpień w oknie wysyłki potrzeba, by alert poszedł (błędy użytkowników ≥ 3). */
  threshold: number
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

const MAX_KEYS = 50
const OVERFLOW = '_overflow'

/**
 * Klucz alertu bez zmiennych części (REL-5): „doc 123”, UUID-y, hashe i cytaty
 * nie tworzą osobnych alertów — ten sam błąd dla różnych dokumentów to jeden wpis.
 */
export function normalizeAlertKey(key: string): string {
  return key
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hash>')
    .replace(/["„“'‘][^"”'’]{0,200}["”'’]/g, '"…"')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function raiseAlert(rawKey: string, message: string, opts: { threshold?: number } = {}) {
  const key = normalizeAlertKey(rawKey)
  const now = Date.now()
  persist(key, message, now)
  const item = state.items.get(key)
  if (item) {
    item.count++
    item.lastAt = now
    return
  }
  if (state.items.size >= MAX_KEYS) {
    // Nic nie ginie po cichu: nadmiar trafia do jednego zbiorczego wpisu.
    const overflow = state.items.get(OVERFLOW)
    if (overflow) {
      overflow.count++
      overflow.lastAt = now
    } else {
      state.items.set(OVERFLOW, {
        message: `More than ${MAX_KEYS} distinct alerts — see the CRM alert list for all of them.`,
        count: 1,
        firstAt: now,
        lastAt: now,
        threshold: 1,
      })
    }
    return
  }
  state.items.set(key, {
    message: message.slice(0, 600),
    count: 1,
    firstAt: now,
    lastAt: now,
    threshold: Math.max(1, opts.threshold ?? 1),
  })
}

/**
 * Zapis w bazie (asynchronicznie, bez czekania). Błąd zapisu tylko `warn` —
 * `error` wywołałby kolejny alert i pętlę.
 */
let persistFailing = false
function persist(key: string, message: string, now: number) {
  if (persistFailing && Math.random() > 0.05) return
  void (async () => {
    try {
      const { default: db } = await import('@adonisjs/lucid/services/db')
      const at = new Date(now)
      await db.rawQuery(
        `insert into ops_alerts (key, message, count, first_at, last_at) values (?, ?, 1, ?, ?)
         on conflict (key) do update set count = ops_alerts.count + 1, message = excluded.message, last_at = excluded.last_at`,
        [key.slice(0, 200), message.slice(0, 2000), at, at]
      )
      persistFailing = false
    } catch (error) {
      persistFailing = true
      logger.warn({ err: error }, 'alert persist failed')
    }
  })()
}

/** Ostatnie alerty z bazy (CRM). */
export async function recentAlerts(limit = 20) {
  const { default: db } = await import('@adonisjs/lucid/services/db')
  const rows = await db.from('ops_alerts').orderBy('last_at', 'desc').limit(limit)
  return rows.map((r) => ({
    key: String(r.key),
    message: String(r.message),
    count: Number(r.count),
    firstAt: new Date(r.first_at).toISOString(),
    lastAt: new Date(r.last_at).toISOString(),
  }))
}

/** Usuwa alerty starsze niż `days` dni. */
export async function purgeAlerts(days = 30): Promise<number> {
  const { default: db } = await import('@adonisjs/lucid/services/db')
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const res = await db.from('ops_alerts').where('last_at', '<', cutoff).delete()
  return Array.isArray(res) ? Number(res[0]) : Number(res)
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
  // Poniżej progu (np. pojedyncza nieudana generacja z winy materiałów) — nie wysyłamy,
  // licznik w oknie się zeruje; wpis i tak jest w bazie i w CRM.
  const items = [...state.items.entries()].filter(([, it]) => it.count >= it.threshold)
  state.items.clear()
  if (items.length === 0) return false
  state.sending = true
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
