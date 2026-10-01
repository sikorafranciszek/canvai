import env from '#start/env'

/**
 * Zaplecze operacyjne: kopie zapasowe, alerty i bezpieczniki wydatków na AI.
 */
export const ops = {
  /** Bezpieczniki kosztów modelu (liczone od północy UTC). */
  aiBudget: {
    /** Globalny dzienny limit tokenów (wejście + wyjście) wszystkich użytkowników; 0 = bez limitu. */
    dailyTokens: env.get('AI_DAILY_TOKEN_BUDGET', 30_000_000),
    /** Ile generacji (DESIGN.md + podglądy) jeden użytkownik może zlecić dziennie; 0 = bez limitu. */
    userDailyGenerations: env.get('AI_USER_DAILY_GENERATIONS', 40),
    /** Dzienny limit tokenów jednego użytkownika; 0 = bez limitu. */
    userDailyTokens: env.get('AI_USER_DAILY_TOKENS', 3_000_000),
  },

  /** Kopie zapasowe: pg_dump + archiwum plików → bucket S3/R2. */
  backup: {
    endpoint: env.get('BACKUP_S3_ENDPOINT') || '',
    region: env.get('BACKUP_S3_REGION') || 'auto',
    bucket: env.get('BACKUP_S3_BUCKET') || '',
    accessKeyId: env.get('BACKUP_S3_ACCESS_KEY_ID') || '',
    secretAccessKey: env.get('BACKUP_S3_SECRET_ACCESS_KEY') || '',
    prefix: (env.get('BACKUP_S3_PREFIX') || 'canvai/').replace(/^\/+/, ''),
    /** Godzina (UTC) codziennej kopii. */
    hourUtc: env.get('BACKUP_HOUR_UTC', 3),
    /** Ile dni trzymać kopie. */
    keepDays: env.get('BACKUP_KEEP_DAYS', 14),
  },

  /** Alerty dla administratorów (ADMIN_EMAILS) i opcjonalnie webhook Slack/Discord. */
  alerts: {
    webhookUrl: env.get('ALERT_WEBHOOK_URL') || '',
    /** Minimalny odstęp między kolejnymi wiadomościami (zdarzenia są agregowane). */
    minIntervalMs: 15 * 60_000,
    /** Wysyłać alerty mailem (gdy poczta skonfigurowana). */
    email: env.get('ALERT_EMAIL', true),
  },
}

export function backupConfigured(): boolean {
  const b = ops.backup
  return Boolean(b.endpoint && b.bucket && b.accessKeyId && b.secretAccessKey)
}
