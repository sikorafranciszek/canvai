import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/** `node ace backup:run` — kopia zapasowa teraz (baza + pliki → S3/R2). */
export default class BackupRun extends BaseCommand {
  static commandName = 'backup:run'
  static description = 'Tworzy kopię zapasową bazy i plików w buckecie S3/R2'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { runBackup } = await import('#services/ops/backup')
    const result = await runBackup()
    for (const f of result.files)
      this.logger.info(`${f.key} — ${(f.bytes / 1024 / 1024).toFixed(1)} MB`)
    this.logger.success(`Kopia ${result.id} gotowa (usunięte stare: ${result.pruned}).`)
  }
}
