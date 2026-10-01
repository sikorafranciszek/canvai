import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/** `node ace backup:list` — lista kopii w buckecie. */
export default class BackupList extends BaseCommand {
  static commandName = 'backup:list'
  static description = 'Pokazuje kopie zapasowe zapisane w buckecie S3/R2'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { listBackups } = await import('#services/ops/backup')
    const backups = await listBackups()
    if (!backups.length) return this.logger.info('Brak kopii.')
    for (const b of backups) {
      this.logger.info(`${b.id}  ${(b.bytes / 1024 / 1024).toFixed(1)} MB  [${b.files.join(', ')}]`)
    }
  }
}
