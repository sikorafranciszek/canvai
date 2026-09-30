import { createClient, type ClickHouseClient } from '@clickhouse/client'
import { analytics } from '#config/analytics'

/**
 * Klient ClickHouse i schemat tabel (tworzony idempotentnie przy starcie).
 * Nazwa bazy trafia do SQL tylko po walidacji (identyfikator).
 */
let client: ClickHouseClient | null = null

export function db(): string {
  const name = analytics.clickhouse.database
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid CLICKHOUSE_DB')
  return name
}

export function clickhouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: analytics.clickhouse.url,
      username: analytics.clickhouse.username,
      password: analytics.clickhouse.password,
      request_timeout: 15_000,
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    })
  }
  return client
}

export async function closeClickhouse() {
  await client?.close()
  client = null
}

export function schemaStatements(): string[] {
  const d = db()
  const { eventsMonths, requestsDays, logsDays } = analytics.retention
  return [
    `CREATE DATABASE IF NOT EXISTS ${d}`,
    `CREATE TABLE IF NOT EXISTS ${d}.events (
      ts DateTime64(3, 'UTC'),
      event LowCardinality(String),
      user_id UInt64,
      visitor_id String,
      board_id UInt64,
      path String,
      route LowCardinality(String),
      referrer_host String,
      utm_source LowCardinality(String),
      utm_medium LowCardinality(String),
      utm_campaign String,
      device LowCardinality(String),
      browser LowCardinality(String),
      os LowCardinality(String),
      locale LowCardinality(String),
      props String
    ) ENGINE = MergeTree
    PARTITION BY toYYYYMM(ts)
    ORDER BY (event, ts, user_id)
    TTL toDateTime(ts) + INTERVAL ${eventsMonths} MONTH`,
    `CREATE TABLE IF NOT EXISTS ${d}.requests (
      ts DateTime64(3, 'UTC'),
      request_id String,
      method LowCardinality(String),
      route LowCardinality(String),
      path String,
      status UInt16,
      duration_ms Float32,
      user_id UInt64,
      visitor_id String,
      device LowCardinality(String),
      browser LowCardinality(String),
      os LowCardinality(String),
      host LowCardinality(String)
    ) ENGINE = MergeTree
    PARTITION BY toYYYYMM(ts)
    ORDER BY (route, ts)
    TTL toDateTime(ts) + INTERVAL ${requestsDays} DAY`,
    `CREATE TABLE IF NOT EXISTS ${d}.logs (
      ts DateTime64(3, 'UTC'),
      level LowCardinality(String),
      msg String,
      request_id String,
      user_id UInt64,
      route LowCardinality(String),
      err_name String,
      err_message String,
      err_stack String,
      context String
    ) ENGINE = MergeTree
    PARTITION BY toYYYYMM(ts)
    ORDER BY (level, ts)
    TTL toDateTime(ts) + INTERVAL ${logsDays} DAY`,
  ]
}

export async function ensureSchema() {
  const ch = clickhouse()
  for (const sql of schemaStatements()) await ch.command({ query: sql })
}

/** Zapytanie z parametrami ({name:Type}) → tablica wierszy. */
export async function select<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const result = await clickhouse().query({ query, query_params: params, format: 'JSONEachRow' })
  return result.json<T>()
}
