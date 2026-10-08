import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace backup:restore <id> --force` — odtwarza bazę (i pliki) z kopii.
 * NADPISUJE bieżące dane, dlatego wymaga `--force`.
 */
export default class BackupRestore extends BaseCommand {
  static commandName = 'backup:restore'
  static description = 'Odtwarza bazę i pliki z kopii zapasowej (nadpisuje dane!)'
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'Identyfikator kopii (z backup:list)' })
  declare id: string

  @flags.boolean({ description: 'Potwierdzenie nadpisania bieżących danych' })
  declare force: boolean

  @flags.boolean({ description: 'Tylko baza, bez plików', default: false })
  declare dbOnly: boolean

  async run() {
    if (!this.force) {
      this.logger.error('Odtworzenie nadpisze bieżącą bazę i pliki. Uruchom ponownie z --force.')
      this.exitCode = 1
      return
    }
    const { restoreBackup } = await import('#services/ops/backup')
    // Procedura (zatrzymanie aplikacji, test kwartalny): docs/backups.md.
    const result = await restoreBackup(this.id, { files: !this.dbOnly })
    this.logger.success(
      `Odtworzono kopię ${this.id}${
        result.files
          ? ` (baza + pliki${result.restored >= 0 ? `: pobrane ${result.restored}, usunięte ${result.removed}` : ''})`
          : ' (baza)'
      }.`
    )
  }
}
