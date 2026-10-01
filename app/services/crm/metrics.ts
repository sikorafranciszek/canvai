import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { analytics } from '#config/analytics'
import { products, type ProductId } from '#config/billing'
import { db as chdb, select } from '#services/analytics/clickhouse'

/**
 * Metryki CRM: dane konta i rozliczeń z bazy aplikacji (SQLite) oraz
 * zachowanie użytkowników, żądania i logi z ClickHouse. Zapytania do
 * ClickHouse są opcjonalne — bez bazy analitycznej CRM pokazuje resztę.
 */

export const RANGES = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 } as const
export type RangeKey = keyof typeof RANGES

export function rangeDays(key: unknown): number {
  return RANGES[(key as RangeKey) in RANGES ? (key as RangeKey) : '30d']
}

export function analyticsAvailable(): boolean {
  return analytics.sink === 'clickhouse'
}

/** Zapytanie CH, które przy braku bazy / błędzie zwraca `null` zamiast rzucać. */
export async function ch<T>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[] | null> {
  if (!analyticsAvailable()) return null
  try {
    return await select<T>(query, params)
  } catch (error) {
    process.stderr.write(`[crm] ClickHouse query failed: ${(error as Error).message}\n`)
    return null
  }
}

function sqlTime(dt: DateTime): string {
  return dt.toUTC().toFormat(db.connection().dialect.dateTimeFormat)
}

/** Kolejne dni (UTC, YYYY-MM-DD) — oś X bez dziur. */
export function dayAxis(days: number): string[] {
  const today = DateTime.utc().startOf('day')
  return Array.from({ length: days }, (_, i) => today.minus({ days: days - 1 - i }).toISODate()!)
}

function fillDays(axis: string[], rows: { day: string; value: number | string }[]) {
  const map = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.value)]))
  return axis.map((day) => ({ day, value: map.get(day) ?? 0 }))
}

function priceCents(productId: string | null): number {
  const product = productId ? products[productId as ProductId] : null
  if (!product) return 0
  const n = Number.parseFloat(product.price.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

async function count(query: any): Promise<number> {
  const rows = await query.count('* as n')
  return Number(rows[0]?.n ?? rows[0]?.$extras?.n ?? 0)
}

// ---------------------------------------------------------------------------
// Pulpit
// ---------------------------------------------------------------------------

export async function dashboard(days: number) {
  const since = DateTime.utc().minus({ days })
  const axis = dayAxis(days)
  const d = chdb()

  const [
    usersTotal,
    usersVerified,
    usersNew,
    signupsRows,
    subsActive,
    packBuyers,
    grants,
    docStatus,
  ] = await Promise.all([
    count(db.from('users')),
    count(db.from('users').whereNotNull('email_verified_at')),
    count(db.from('users').where('created_at', '>=', sqlTime(since))),
    db
      .from('users')
      .where('created_at', '>=', sqlTime(since.startOf('day')))
      .select(db.raw("to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day"))
      .count('* as value')
      .groupBy('day'),
    db
      .from('subscriptions')
      .whereIn('status', ['active', 'trialing', 'past_due'])
      .select('plan')
      .count('* as n')
      .groupBy('plan'),
    db
      .from('credit_grants')
      .where('source', 'pack')
      .whereNull('revoked_at')
      .countDistinct('user_id as n')
      .then((rows: any[]) => Number(rows[0]?.n ?? 0)),
    // Produkt zakupu jest zapisany w notatce transakcji `grant` tej puli.
    db
      .from('credit_grants as g')
      .leftJoin('credit_transactions as t', (j) =>
        j.on('t.grant_id', 'g.id').andOnVal('t.kind', 'grant')
      )
      .whereIn('g.source', ['pack', 'subscription'])
      .whereNull('g.revoked_at')
      .select('g.source', 't.note', 'g.amount', 'g.created_at'),
    db
      .from('design_docs')
      .where('created_at', '>=', sqlTime(since))
      .select('status')
      .count('* as n')
      .groupBy('status'),
  ])

  // node-postgres zwraca znaczniki czasu jako Date.
  const revenueRows = (grants as { note: string | null; created_at: Date | string }[]).map((g) => ({
    cents: priceCents(g.note),
    day: new Date(g.created_at).toISOString().slice(0, 10),
  }))
  const sinceDay = since.toISODate()!
  const proActive =
    (subsActive as { plan: string; n: number }[]).find((s) => s.plan === 'pro')?.n ?? 0
  const statusMap = Object.fromEntries(
    (docStatus as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)])
  )
  const generations = Object.values(statusMap).reduce((a, b) => a + b, 0)

  const [activeRows, dauRows, credits, durations, topRoutes, referrers, devices, errors] =
    await Promise.all([
      ch<{ day: string; users: string; visitors: string; views: string }>(
        `SELECT toDate(ts) AS day,
              uniqExactIf(user_id, user_id > 0) AS users,
              uniqExact(if(user_id > 0, toString(user_id), visitor_id)) AS visitors,
              countIf(event = 'page_view') AS views
       FROM ${d}.events WHERE ts >= now() - toIntervalDay({days:UInt32}) GROUP BY day ORDER BY day`,
        { days }
      ),
      ch<{ dau: string; wau: string; mau: string }>(
        `SELECT uniqExactIf(user_id, user_id > 0 AND ts >= now() - INTERVAL 1 DAY) AS dau,
              uniqExactIf(user_id, user_id > 0 AND ts >= now() - INTERVAL 7 DAY) AS wau,
              uniqExactIf(user_id, user_id > 0 AND ts >= now() - INTERVAL 30 DAY) AS mau
       FROM ${d}.events WHERE ts >= now() - INTERVAL 30 DAY`
      ),
      db
        .from('credit_transactions')
        .where('created_at', '>=', sqlTime(since))
        .select('kind')
        .sum('amount as total')
        .groupBy('kind'),
      ch<{ avg: number; p95: number }>(
        `SELECT avg(JSONExtractFloat(props, 'durationMs')) AS avg,
              quantile(0.95)(JSONExtractFloat(props, 'durationMs')) AS p95
       FROM ${d}.events WHERE event = 'design_doc_ready' AND ts >= now() - toIntervalDay({days:UInt32})`,
        { days }
      ),
      ch<{ route: string; views: string; visitors: string }>(
        `SELECT route, count() AS views, uniqExact(if(user_id > 0, toString(user_id), visitor_id)) AS visitors
       FROM ${d}.events WHERE event = 'page_view' AND ts >= now() - toIntervalDay({days:UInt32})
       GROUP BY route ORDER BY views DESC LIMIT 8`,
        { days }
      ),
      ch<{ host: string; visits: string }>(
        `SELECT referrer_host AS host, count() AS visits FROM ${d}.events
       WHERE event = 'page_view' AND referrer_host != '' AND ts >= now() - toIntervalDay({days:UInt32})
       GROUP BY host ORDER BY visits DESC LIMIT 6`,
        { days }
      ),
      ch<{ device: string; n: string }>(
        `SELECT device, uniqExact(if(user_id > 0, toString(user_id), visitor_id)) AS n FROM ${d}.events
       WHERE event = 'page_view' AND ts >= now() - toIntervalDay({days:UInt32}) GROUP BY device ORDER BY n DESC`,
        { days }
      ),
      ch<{ n: string }>(
        `SELECT count() AS n FROM ${d}.logs WHERE level IN ('error', 'fatal') AND ts >= now() - toIntervalDay({days:UInt32})`,
        { days }
      ),
    ])

  const creditMap = Object.fromEntries(
    (credits as { kind: string; total: number }[]).map((r) => [r.kind, Number(r.total)])
  )
  const dayRevenue = new Map<string, number>()
  for (const r of revenueRows)
    if (r.day >= sinceDay) dayRevenue.set(r.day, (dayRevenue.get(r.day) ?? 0) + r.cents)

  return {
    days,
    analytics: analyticsAvailable(),
    kpis: {
      usersTotal,
      usersVerified,
      usersNew,
      proActive: Number(proActive),
      packBuyers: Number(packBuyers),
      mrrCents: Number(proActive) * priceCents('pro'),
      revenueCents: revenueRows.filter((r) => r.day >= sinceDay).reduce((a, r) => a + r.cents, 0),
      revenueTotalCents: revenueRows.reduce((a, r) => a + r.cents, 0),
      creditsGranted: creditMap.grant ?? 0,
      creditsSpent: -((creditMap.reserve ?? 0) + (creditMap.release ?? 0)),
      generations,
      generationsFailed: statusMap.failed ?? 0,
      avgGenerationMs: durations?.[0]?.avg ? Math.round(Number(durations[0].avg)) : null,
      p95GenerationMs: durations?.[0]?.p95 ? Math.round(Number(durations[0].p95)) : null,
      dau: dauRows ? Number(dauRows[0]?.dau ?? 0) : null,
      wau: dauRows ? Number(dauRows[0]?.wau ?? 0) : null,
      mau: dauRows ? Number(dauRows[0]?.mau ?? 0) : null,
      errors: errors ? Number(errors[0]?.n ?? 0) : null,
    },
    series: {
      signups: fillDays(axis, signupsRows as { day: string; value: number }[]),
      revenue: axis.map((day) => ({ day, value: (dayRevenue.get(day) ?? 0) / 100 })),
      activeUsers: activeRows
        ? fillDays(
            axis,
            activeRows.map((r) => ({ day: r.day, value: r.users }))
          )
        : null,
      visitors: activeRows
        ? fillDays(
            axis,
            activeRows.map((r) => ({ day: r.day, value: r.visitors }))
          )
        : null,
      pageViews: activeRows
        ? fillDays(
            axis,
            activeRows.map((r) => ({ day: r.day, value: r.views }))
          )
        : null,
    },
    topRoutes:
      topRoutes?.map((r) => ({
        route: r.route || '(inna)',
        views: Number(r.views),
        visitors: Number(r.visitors),
      })) ?? null,
    referrers: referrers?.map((r) => ({ host: r.host, visits: Number(r.visits) })) ?? null,
    devices: devices?.map((r) => ({ device: r.device || 'unknown', count: Number(r.n) })) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Analityka: lejek, retencja, zdarzenia
// ---------------------------------------------------------------------------

export const FUNNEL = [
  'signup',
  'email_verified',
  'board_created',
  'design_doc_ready',
  'purchase',
] as const

export async function funnel(days: number) {
  const d = chdb()
  const rows = await ch<{ level: number; users: string }>(
    `SELECT level, count() AS users FROM (
       SELECT user_id, windowFunnel(toUInt64({days:UInt32}) * 86400)(toDateTime(ts),
         event = 'signup', event = 'email_verified', event = 'board_created',
         event = 'design_doc_ready', event = 'purchase') AS level
       FROM ${d}.events
       WHERE user_id > 0 AND ts >= now() - toIntervalDay({days:UInt32})
       GROUP BY user_id
     ) GROUP BY level`,
    { days }
  )
  if (!rows) return null
  // Liczba użytkowników, którzy doszli CO NAJMNIEJ do danego kroku.
  return FUNNEL.map((step, i) => ({
    step,
    users: rows.filter((r) => Number(r.level) >= i + 1).reduce((a, r) => a + Number(r.users), 0),
  }))
}

export async function retention(weeks = 8) {
  const d = chdb()
  const rows = await ch<{ cohort: string; n: number; users: string }>(
    `WITH signups AS (
       SELECT user_id, toMonday(min(ts)) AS cohort FROM ${d}.events
       WHERE event = 'signup' AND ts >= toMonday(now()) - toIntervalWeek({weeks:UInt32})
       GROUP BY user_id
     ),
     activity AS (
       SELECT DISTINCT user_id, toMonday(ts) AS week FROM ${d}.events
       WHERE user_id > 0 AND ts >= toMonday(now()) - toIntervalWeek({weeks:UInt32})
     )
     SELECT toString(s.cohort) AS cohort, dateDiff('week', s.cohort, a.week) AS n, uniqExact(a.user_id) AS users
     FROM signups AS s INNER JOIN activity AS a ON a.user_id = s.user_id
     WHERE a.week >= s.cohort
     GROUP BY cohort, n ORDER BY cohort, n`,
    { weeks }
  )
  if (!rows) return null
  const cohorts = [...new Set(rows.map((r) => r.cohort))]
  return cohorts.map((cohort) => {
    const cells = rows.filter((r) => r.cohort === cohort)
    const size = Number(cells.find((c) => Number(c.n) === 0)?.users ?? 0)
    return {
      cohort,
      size,
      weeks: Array.from({ length: weeks + 1 }, (_, n) => {
        const users = Number(cells.find((c) => Number(c.n) === n)?.users ?? 0)
        return size ? Math.round((users / size) * 100) : 0
      }),
    }
  })
}

export async function eventTypes(days: number) {
  const d = chdb()
  const rows = await ch<{ event: string; n: string; users: string }>(
    `SELECT event, count() AS n, uniqExactIf(user_id, user_id > 0) AS users FROM ${d}.events
     WHERE ts >= now() - toIntervalDay({days:UInt32}) GROUP BY event ORDER BY n DESC`,
    { days }
  )
  return rows?.map((r) => ({ event: r.event, count: Number(r.n), users: Number(r.users) })) ?? null
}

export async function eventSeries(event: string, days: number) {
  const d = chdb()
  const rows = await ch<{ day: string; value: string }>(
    `SELECT toDate(ts) AS day, count() AS value FROM ${d}.events
     WHERE event = {event:String} AND ts >= now() - toIntervalDay({days:UInt32}) GROUP BY day ORDER BY day`,
    { event, days }
  )
  return rows ? fillDays(dayAxis(days), rows) : null
}

export async function recentEvents(filters: { event?: string; userId?: number }, limit = 100) {
  const d = chdb()
  const where = ['1']
  if (filters.event) where.push('event = {event:String}')
  if (filters.userId) where.push('user_id = {userId:UInt64}')
  const rows = await ch<Record<string, any>>(
    `SELECT toString(ts) AS ts, event, user_id, board_id, route, path, device, browser, os, referrer_host, props
     FROM ${d}.events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { ...filters, limit }
  )
  return (
    rows?.map((r) => ({ ...r, user_id: Number(r.user_id), board_id: Number(r.board_id) })) ?? null
  )
}

// ---------------------------------------------------------------------------
// Logi i żądania
// ---------------------------------------------------------------------------

export async function logs(
  filters: { level?: string; q?: string; userId?: number; days: number },
  limit = 200
) {
  const d = chdb()
  const where = ['ts >= now() - toIntervalDay({days:UInt32})']
  if (filters.level) where.push('level = {level:String}')
  if (filters.q)
    where.push(
      '(positionCaseInsensitive(msg, {q:String}) > 0 OR positionCaseInsensitive(err_message, {q:String}) > 0 OR request_id = {q:String})'
    )
  if (filters.userId) where.push('user_id = {userId:UInt64}')
  const rows = await ch<Record<string, any>>(
    `SELECT toString(ts) AS ts, level, msg, request_id, user_id, route, err_name, err_message, err_stack, context
     FROM ${d}.logs WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { ...filters, limit }
  )
  return rows?.map((r) => ({ ...r, user_id: Number(r.user_id) })) ?? null
}

export async function logLevels(days: number) {
  const d = chdb()
  const rows = await ch<{ level: string; n: string }>(
    `SELECT level, count() AS n FROM ${d}.logs WHERE ts >= now() - toIntervalDay({days:UInt32}) GROUP BY level`,
    { days }
  )
  return rows?.map((r) => ({ level: r.level, count: Number(r.n) })) ?? null
}

export async function errorGroups(days: number) {
  const d = chdb()
  const rows = await ch<Record<string, any>>(
    `SELECT if(err_name = '', 'Log', err_name) AS name, substring(if(err_message = '', msg, err_message), 1, 160) AS message,
            count() AS n, toString(max(ts)) AS last_seen, uniqExactIf(user_id, user_id > 0) AS users, any(route) AS route
     FROM ${d}.logs WHERE level IN ('error', 'fatal') AND ts >= now() - toIntervalDay({days:UInt32})
     GROUP BY name, message ORDER BY n DESC LIMIT 30`,
    { days }
  )
  return rows?.map((r) => ({ ...r, n: Number(r.n), users: Number(r.users) })) ?? null
}

export async function routeStats(days: number) {
  const d = chdb()
  const rows = await ch<Record<string, any>>(
    `SELECT method, route, count() AS n, round(quantile(0.5)(duration_ms), 1) AS p50,
            round(quantile(0.95)(duration_ms), 1) AS p95, countIf(status >= 500) AS errors, countIf(status >= 400 AND status < 500) AS client_errors
     FROM ${d}.requests WHERE ts >= now() - toIntervalDay({days:UInt32}) AND route != ''
     GROUP BY method, route ORDER BY n DESC LIMIT 40`,
    { days }
  )
  return (
    rows?.map((r) => ({
      ...r,
      n: Number(r.n),
      p50: Number(r.p50),
      p95: Number(r.p95),
      errors: Number(r.errors),
      client_errors: Number(r.client_errors),
    })) ?? null
  )
}

export async function requestSeries(days: number) {
  const d = chdb()
  const rows = await ch<{ day: string; value: string; errors: string }>(
    `SELECT toDate(ts) AS day, count() AS value, countIf(status >= 500) AS errors FROM ${d}.requests
     WHERE ts >= now() - toIntervalDay({days:UInt32}) GROUP BY day ORDER BY day`,
    { days }
  )
  if (!rows) return null
  const axis = dayAxis(days)
  return {
    requests: fillDays(axis, rows),
    errors: fillDays(
      axis,
      rows.map((r) => ({ day: r.day, value: r.errors }))
    ),
  }
}

// ---------------------------------------------------------------------------
// Użytkownik
// ---------------------------------------------------------------------------

export async function userActivity(userIds: number[]) {
  if (!userIds.length) return new Map<number, { lastSeen: string; events30d: number }>()
  const d = chdb()
  const rows = await ch<{ user_id: string; last_seen: string; n: string }>(
    `SELECT user_id, toString(max(ts)) AS last_seen, countIf(ts >= now() - INTERVAL 30 DAY) AS n
     FROM ${d}.events WHERE user_id IN {ids:Array(UInt64)} GROUP BY user_id`,
    { ids: userIds }
  )
  return new Map(
    (rows ?? []).map((r) => [Number(r.user_id), { lastSeen: r.last_seen, events30d: Number(r.n) }])
  )
}

/** RODO: usunięcie danych analitycznych użytkownika (mutacje ClickHouse). */
export async function eraseUserAnalytics(userId: number) {
  if (!analyticsAvailable()) return
  const d = chdb()
  const { clickhouse } = await import('#services/analytics/clickhouse')
  for (const table of ['events', 'requests', 'logs']) {
    await clickhouse().command({
      query: `ALTER TABLE ${d}.${table} DELETE WHERE user_id = {userId:UInt64}`,
      query_params: { userId },
    })
  }
}
