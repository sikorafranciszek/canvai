/*
|--------------------------------------------------------------------------
| Analityka i logi → ClickHouse
|--------------------------------------------------------------------------
|
| Podpina odbiorcę logów (hook pino z config/logger.ts), zakłada schemat
| tabel przy starcie i opróżnia bufor przy zamykaniu procesu.
|
*/
import { format } from 'node:util'
import app from '@adonisjs/core/services/app'
import { analytics } from '#config/analytics'
import { captureLog, shutdown } from '#services/analytics/collector'
import { ensureSchema } from '#services/analytics/clickhouse'
import { raiseAlert } from '#services/ops/alerts'

;(globalThis as any).__canvaiLogSink = (
  level: number,
  args: unknown[],
  bindings: Record<string, unknown>
) => {
  const [first, second] = args
  const obj =
    first && typeof first === 'object' && !(first instanceof Error)
      ? (first as Record<string, unknown>)
      : {}
  const err = first instanceof Error ? { err: first } : {}
  // Komunikat z parametrami w stylu printf (pino: logger.info('x %s', a)).
  const msg =
    typeof first === 'string'
      ? format(first, ...args.slice(1))
      : typeof second === 'string'
        ? format(second, ...args.slice(2))
        : first instanceof Error
          ? first.message
          : ''
  captureLog(level, msg, { ...bindings, ...obj, ...err })
  // Błędy serwera (error/fatal) → alert dla administratorów (agregowany).
  if (level >= 50) {
    const detail = err.err?.message ?? (obj.err as Error | undefined)?.message ?? ''
    const url = typeof obj.url === 'string' ? ` ${obj.url}` : ''
    raiseAlert(`log:${msg.slice(0, 80)}`, `${msg}${url}${detail ? ` — ${detail}` : ''}`)
  }
}

if (analytics.sink === 'clickhouse') {
  ensureSchema().catch((error) => {
    process.stderr.write(`[analytics] ClickHouse schema not ready: ${(error as Error).message}\n`)
  })
}

// Widoczne w logach kontenera: czy ADMIN_EMAILS dotarło do aplikacji.
if (app.getEnvironment() === 'web') {
  const { crm } = await import('#config/analytics')
  process.stdout.write(
    `[crm] host ${crm.host}, administratorzy: ${crm.adminEmails.length}${crm.adminEmails.length ? ` (${crm.adminEmails.map((e) => e.replace(/^(.).*(@.*)$/, '$1…$2')).join(', ')})` : ' — ustaw ADMIN_EMAILS'}\n`
  )
}

app.terminating(async () => {
  await shutdown()
})
