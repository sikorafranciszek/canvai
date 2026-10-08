/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database
  DB_CONNECTION: Env.schema.enum.optional(['pg', 'sqlite'] as const),
  DB_HOST: Env.schema.string.optional({ format: 'host' }),
  DB_PORT: Env.schema.number.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),
  DB_SSL: Env.schema.boolean.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),
  DB_DEBUG: Env.schema.boolean.optional(),

  // AI (M3: analiza assetów → DESIGN.md)
  // Bez klucza pipeline działa na dostawcy `mock` — aplikacja startuje normalnie.
  AI_PROVIDER: Env.schema.enum.optional(['mock', 'deepseek'] as const),
  ALLOW_MOCK_AI: Env.schema.boolean.optional(),
  DEEPSEEK_API_KEY: Env.schema.string.optional(),
  DEEPSEEK_BASE_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  DEEPSEEK_VISION_MODEL: Env.schema.string.optional(),
  DEEPSEEK_TEXT_MODEL: Env.schema.string.optional(),
  DEEPSEEK_REASONING_MODEL: Env.schema.string.optional(),
  DEEPSEEK_THINKING: Env.schema.enum.optional(['off', 'low', 'high'] as const),

  /*
  |----------------------------------------------------------
  | Rozliczenia — Polar.sh
  |----------------------------------------------------------
  */
  BILLING_ENFORCED: Env.schema.boolean.optional(),
  /** Microsoft Clarity (projekt app.canvai.dev) — ładowany dopiero po zgodzie. */
  CLARITY_PROJECT_ID: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Analityka i logi (ClickHouse) + CRM
  |----------------------------------------------------------
  */
  CLICKHOUSE_URL: Env.schema.string.optional(),
  CLICKHOUSE_USER: Env.schema.string.optional(),
  CLICKHOUSE_PASSWORD: Env.schema.string.optional(),
  CLICKHOUSE_DB: Env.schema.string.optional(),
  /** Host panelu CRM (domyślnie crm.localhost w dev). */
  CRM_HOST: Env.schema.string.optional(),
  /** Adresy e-mail administratorów CRM (po przecinku). */
  ADMIN_EMAILS: Env.schema.string.optional(),
  POLAR_ACCESS_TOKEN: Env.schema.string.optional(),
  POLAR_WEBHOOK_SECRET: Env.schema.string.optional(),
  POLAR_SERVER: Env.schema.enum.optional(['production', 'sandbox'] as const),
  POLAR_PRODUCT_PACK_S: Env.schema.string.optional(),
  POLAR_PRODUCT_PACK_M: Env.schema.string.optional(),
  POLAR_PRODUCT_PACK_L: Env.schema.string.optional(),
  POLAR_PRODUCT_PRO: Env.schema.string.optional(),
  POLAR_PRODUCT_TEAM: Env.schema.string.optional(),
  POLAR_PRODUCT_AGENCY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Zaplecze: kopie zapasowe, alerty, limity wydatków na AI
  |----------------------------------------------------------
  */
  AI_DAILY_TOKEN_BUDGET: Env.schema.number.optional(),
  AI_USER_DAILY_GENERATIONS: Env.schema.number.optional(),
  AI_USER_DAILY_TOKENS: Env.schema.number.optional(),
  BACKUP_S3_ENDPOINT: Env.schema.string.optional(),
  BACKUP_S3_REGION: Env.schema.string.optional(),
  BACKUP_S3_BUCKET: Env.schema.string.optional(),
  BACKUP_S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: Env.schema.string.optional(),
  BACKUP_S3_PREFIX: Env.schema.string.optional(),
  BACKUP_HOUR_UTC: Env.schema.number.optional(),
  BACKUP_KEEP_DAYS: Env.schema.number.optional(),
  ALERT_WEBHOOK_URL: Env.schema.string.optional(),
  ALERT_EMAIL: Env.schema.boolean.optional(),
  /** Token do szczegółów /health/deep (monitoring). Bez niego tylko status. */
  HEALTH_TOKEN: Env.schema.string.optional(),

  // Produkcja: trwałe ścieżki na wolumenie i zaufanie do reverse proxy.
  SQLITE_PATH: Env.schema.string.optional(),
  STORAGE_PATH: Env.schema.string.optional(),
  TRUST_PROXY: Env.schema.boolean.optional(),

  // Kolejka: worker in-process w `node ace serve` (domyślnie włączony).
  QUEUE_INLINE_WORKER: Env.schema.boolean.optional(),

  // Poczta: `outbox` (domyślnie, lokalnie — tmp/mail-outbox) albo `smtp`.
  MAIL_MAILER: Env.schema.enum.optional(['outbox', 'smtp', 'resend'] as const),
  RESEND_API_KEY: Env.schema.string.optional(),
  MAIL_FROM_NAME: Env.schema.string.optional(),
  MAIL_FROM_ADDRESS: Env.schema.string.optional(),
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.number.optional(),
  SMTP_SECURE: Env.schema.boolean.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
})
