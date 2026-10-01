import { backupConfigured, ops } from '#config/ops'
import { dailyAt, registerTask } from '#services/ops/scheduler'

/**
 * Rejestr zadań cyklicznych aplikacji. Importowany przez worker (`start/worker.ts`).
 */
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
