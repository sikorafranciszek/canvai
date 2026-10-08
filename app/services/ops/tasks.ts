import { backupConfigured, ops } from '#config/ops'
import { analytics } from '#config/analytics'
import { dailyAt, every, registerTask } from '#services/ops/scheduler'

/**
 * Rejestr zadań cyklicznych aplikacji. Importowany przez worker (`start/worker.ts`).
 */
registerTask({
  name: 'lifecycle_emails',
  due: every(60),
  async run() {
    const { runLifecycleEmails } = await import('#services/lifecycle_mail')
    const sent = await runLifecycleEmails()
    return Object.entries(sent)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  },
})

/**
 * Jednorazowo (SEC-5): usunięcie tokenów z zapisanych już ścieżek w ClickHouse.
 * Nowe zapisy są czyszczone w middleware; to zadanie poprawia historię.
 */
registerTask({
  name: 'analytics_scrub_tokens_v1',
  due: (last) => last === null && analytics.sink === 'clickhouse',
  async run() {
    const { clickhouse, db } = await import('#services/analytics/clickhouse')
    const d = db()
    const re = "'/[A-Za-z0-9_.~%-]{20,}'"
    for (const table of ['requests', 'events']) {
      await clickhouse().command({
        query: `ALTER TABLE ${d}.${table} UPDATE path = replaceRegexpAll(path, ${re}, '/[redacted]') WHERE match(path, ${re})`,
      })
    }
    return 'scrubbed requests.path and events.path'
  },
})

/** Codzienne usuwanie wygasłych liczników limitów żądań. */
registerTask({
  name: 'rate_limits_purge',
  due: every(24 * 60),
  async run() {
    const { purgeExpired } = await import('#services/rate_limit')
    return `purged ${await purgeExpired()} expired counters`
  },
})

/** Cotygodniowe sprzątanie plików bez wiersza w bazie (DAT-8). */
registerTask({
  name: 'orphan_files',
  due: every(7 * 24 * 60),
  async run() {
    const { sweepOrphanFiles } = await import('#services/assets_service')
    return `removed ${await sweepOrphanFiles()} orphan files`
  },
})

registerTask({
  name: 'backup',
  due: (last, now) => backupConfigured() && dailyAt(ops.backup.hourUtc)(last, now),
  async run() {
    const { runBackup } = await import('#services/ops/backup')
    const result = await runBackup()
    const mb = result.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024
    return `${result.id}: ${result.files.length} files, ${mb.toFixed(1)} MB, pruned ${result.pruned}`
  },
})
