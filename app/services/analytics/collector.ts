import { createHash } from 'node:crypto'
import env from '#start/env'
import { analytics } from '#config/analytics'
import { clickhouse, db, ensureSchema } from '#services/analytics/clickhouse'

/**
 * Zbieranie analityki i logów: bufor w pamięci → paczki do ClickHouse.
 *
 * Prywatność: nie ustawiamy żadnych cookies. Zalogowanych rozpoznajemy po
 * `user_id`; anonimowego odwiedzającego — po `visitor_id` = skrót z IP
 * i przeglądarki z solą zmienianą codziennie (nie da się go śledzić między
 * dniami ani odwrócić do IP).
 */

export type Table = 'events' | 'requests' | 'logs'
type Row = Record<string, unknown>

const buffers: Record<Table, Row[]> = { events: [], requests: [], logs: [] }
/** Wiersze zapisane przez sink `memory` (testy). */
export const memory: Record<Table, Row[]> = { events: [], requests: [], logs: [] }

let timer: ReturnType<typeof setInterval> | null = null
let flushing: Promise<void> | null = null
let schemaReady = false
let dropped = 0

export function nowTs(): string {
  // DateTime64(3) w UTC — format akceptowany przez `best_effort`.
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function push(table: Table, row: Row) {
  if (analytics.sink === 'off') return
  if (analytics.sink === 'memory') {
    memory[table].push(row)
    return
  }
  const total = buffers.events.length + buffers.requests.length + buffers.logs.length
  if (total >= analytics.maxBuffer) {
    dropped++
    return
  }
  buffers[table].push(row)
  startTimer()
  if (buffers[table].length >= analytics.batchSize) void flush()
}

function startTimer() {
  if (timer) return
  timer = setInterval(() => void flush(), analytics.flushIntervalMs)
  timer.unref?.()
}

/** Wysyła zbuforowane wiersze. Błąd → wiersze wracają do bufora (do limitu). */
export async function flush(): Promise<void> {
  if (analytics.sink !== 'clickhouse') return
  if (flushing) return flushing
  flushing = (async () => {
    try {
      if (!schemaReady) {
        await ensureSchema()
        schemaReady = true
      }
      for (const table of Object.keys(buffers) as Table[]) {
        const rows = buffers[table].splice(0, buffers[table].length)
        if (!rows.length) continue
        try {
          await clickhouse().insert({
            table: `${db()}.${table}`,
            values: rows,
            format: 'JSONEachRow',
          })
        } catch (error) {
          buffers[table].unshift(...rows.slice(0, analytics.maxBuffer))
          throw error
        }
      }
    } catch (error) {
      // Nie przez logger — log trafiłby z powrotem do bufora (pętla).
      process.stderr.write(`[analytics] flush failed: ${(error as Error).message}\n`)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

export async function shutdown() {
  if (timer) clearInterval(timer)
  timer = null
  await flush()
}

export function stats() {
  return {
    sink: analytics.sink,
    buffered: buffers.events.length + buffers.requests.length + buffers.logs.length,
    dropped,
  }
}

// ---------------------------------------------------------------------------
// Kontekst: odwiedzający, urządzenie
// ---------------------------------------------------------------------------

/** Anonimowy identyfikator dnia: sha256(sól dnia + IP + UA), bez cookies. */
export function visitorId(
  ip: string | undefined,
  ua: string | undefined,
  date = new Date()
): string {
  const salt = `${env.get('APP_KEY').release()}:${date.toISOString().slice(0, 10)}`
  return createHash('sha256')
    .update(`${salt}|${ip ?? ''}|${ua ?? ''}`)
    .digest('hex')
    .slice(0, 16)
}

export interface DeviceInfo {
  device: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'
  browser: string
  os: string
}

export function parseUserAgent(ua: string | undefined): DeviceInfo {
  const s = ua ?? ''
  if (!s) return { device: 'unknown', browser: 'unknown', os: 'unknown' }
  const bot =
    /bot|crawl|spider|slurp|headless|lighthouse|curl|wget|python-requests|axios|node-fetch/i.test(s)
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(s)
  const mobile = !tablet && /mobi|iphone|ipod|android/i.test(s)
  const browser = /edg\//i.test(s)
    ? 'Edge'
    : /opr\/|opera/i.test(s)
      ? 'Opera'
      : /firefox|fxios/i.test(s)
        ? 'Firefox'
        : /chrome|crios|chromium/i.test(s)
          ? 'Chrome'
          : /safari/i.test(s)
            ? 'Safari'
            : 'Other'
  const os = /windows/i.test(s)
    ? 'Windows'
    : /iphone|ipad|ipod|ios/i.test(s)
      ? 'iOS'
      : /mac os x|macintosh/i.test(s)
        ? 'macOS'
        : /android/i.test(s)
          ? 'Android'
          : /linux/i.test(s)
            ? 'Linux'
            : 'Other'
  return { device: bot ? 'bot' : tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', browser, os }
}

export function refererHost(referer: string | undefined, ownHost: string): string {
  if (!referer) return ''
  try {
    const host = new URL(referer).hostname
    return host === ownHost ? '' : host
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Publiczne API
// ---------------------------------------------------------------------------

export interface EventContext {
  userId?: number | null
  visitorId?: string
  boardId?: number | null
  path?: string
  route?: string
  referrerHost?: string
  utm?: { source?: string; medium?: string; campaign?: string }
  device?: DeviceInfo
  locale?: string
}

/** Zdarzenie produktowe (np. `design_doc_ready`) z właściwościami. */
export function track(event: string, props: Record<string, unknown> = {}, ctx: EventContext = {}) {
  push('events', {
    ts: nowTs(),
    event,
    user_id: ctx.userId ?? 0,
    visitor_id: ctx.visitorId ?? '',
    board_id: ctx.boardId ?? 0,
    path: ctx.path ?? '',
    route: ctx.route ?? '',
    referrer_host: ctx.referrerHost ?? '',
    utm_source: ctx.utm?.source ?? '',
    utm_medium: ctx.utm?.medium ?? '',
    utm_campaign: ctx.utm?.campaign ?? '',
    device: ctx.device?.device ?? '',
    browser: ctx.device?.browser ?? '',
    os: ctx.device?.os ?? '',
    locale: ctx.locale ?? '',
    props: JSON.stringify(props),
  })
}

export interface RequestRow {
  requestId: string
  method: string
  route: string
  path: string
  status: number
  durationMs: number
  userId: number | null
  visitorId: string
  device: DeviceInfo
  host: string
}

export function trackRequest(r: RequestRow) {
  push('requests', {
    ts: nowTs(),
    request_id: r.requestId,
    method: r.method,
    route: r.route,
    path: r.path,
    status: r.status,
    duration_ms: Math.round(r.durationMs * 10) / 10,
    user_id: r.userId ?? 0,
    visitor_id: r.visitorId,
    device: r.device.device,
    browser: r.device.browser,
    os: r.device.os,
    host: r.host,
  })
}

const LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

/** Wpis logu (z hooka pino). Pola znane trafiają do kolumn, reszta do `context`. */
export function captureLog(level: number, msg: string, obj: Record<string, any> = {}) {
  const { err, error, request_id: rid, requestId, userId, route, ...rest } = obj
  const e = (err ?? error) as { name?: string; message?: string; stack?: string } | undefined
  let context = ''
  try {
    context = Object.keys(rest).length ? JSON.stringify(rest).slice(0, 8000) : ''
  } catch {
    context = ''
  }
  push('logs', {
    ts: nowTs(),
    level: LEVELS[level] ?? String(level),
    msg: String(msg ?? '').slice(0, 4000),
    request_id: String(rid ?? requestId ?? ''),
    user_id: Number(userId) || 0,
    route: String(route ?? ''),
    err_name: e?.name ?? '',
    err_message: (e?.message ?? '').slice(0, 2000),
    err_stack: (e?.stack ?? '').slice(0, 8000),
    context,
  })
}

/** Test: wyczyść bufory pamięciowe. */
export function resetMemory() {
  for (const t of Object.keys(memory) as Table[]) memory[t].length = 0
}
