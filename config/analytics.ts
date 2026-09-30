import env from '#start/env'
import app from '@adonisjs/core/services/app'

/**
 * Analityka produktu i logi aplikacji → ClickHouse.
 *
 * Zbieranie działa w procesie aplikacji: wiersze trafiają do bufora w pamięci
 * i są wysyłane paczkami (co `flushIntervalMs` albo po `batchSize` wierszach).
 * Awaria ClickHouse nie zatrzymuje aplikacji — bufor ma twardy limit, nadmiar
 * jest odrzucany.
 */
export const analytics = {
  /** `clickhouse` = zapis do bazy, `memory` = testy, `off` = wyłączone. */
  sink: (app.inTest ? 'memory' : env.get('CLICKHOUSE_URL') ? 'clickhouse' : 'off') as
    'clickhouse' | 'memory' | 'off',
  clickhouse: {
    url: env.get('CLICKHOUSE_URL') || 'http://127.0.0.1:8123',
    username: env.get('CLICKHOUSE_USER') || 'default',
    password: env.get('CLICKHOUSE_PASSWORD') || '',
    database: env.get('CLICKHOUSE_DB') || 'canvai',
  },
  flushIntervalMs: 5000,
  batchSize: 1000,
  /** Twardy limit bufora na wypadek niedostępnej bazy. */
  maxBuffer: 50_000,
  /** Retencja zgodna z polityką prywatności. */
  retention: { eventsMonths: 13, requestsDays: 90, logsDays: 90 },
}

/** Panel CRM (crm.canvai.dev) — dostęp tylko dla administratorów. */
export const crm = {
  host: env.get('CRM_HOST') || (app.inProduction ? 'crm.canvai.dev' : 'crm.localhost'),
  adminEmails: (env.get('ADMIN_EMAILS') || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
}
