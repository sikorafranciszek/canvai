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
}

if (analytics.sink === 'clickhouse') {
  ensureSchema().catch((error) => {
    process.stderr.write(`[analytics] ClickHouse schema not ready: ${(error as Error).message}\n`)
  })
}

app.terminating(async () => {
  await shutdown()
})
