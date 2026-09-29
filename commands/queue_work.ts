import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace queue:work` — osobny proces workera kolejki (produkcja / wiele
 * instancji). W dev wystarczy worker in-process z `start/worker.ts`.
 */
export default class QueueWork extends BaseCommand {
  static commandName = 'queue:work'
  static description = 'Przetwarza zadania z tabeli jobs (generacje DESIGN.md)'
  static options: CommandOptions = { startApp: true, staysAlive: true }

  @flags.boolean({ description: 'Przetwórz oczekujące zadania i zakończ' })
  declare once: boolean

  @flags.number({ description: 'Interwał odpytywania w ms', default: 1000 })
  declare interval: number

  async run() {
    const { recoverStaleJobs, runPendingJobs } = await import('#services/queue')

    if (this.once) {
      await recoverStaleJobs()
      const count = await runPendingJobs()
      this.logger.info(`Przetworzono zadań: ${count}`)
      await this.terminate()
      return
    }

    this.logger.info('Worker kolejki działa (Ctrl+C aby zakończyć)')
    let stopped = false
    this.app.terminating(() => {
      stopped = true
    })

    let lastRecover = 0
    while (!stopped) {
      if (Date.now() - lastRecover > 60_000) {
        lastRecover = Date.now()
        await recoverStaleJobs()
      }
      const count = await runPendingJobs(10)
      if (count > 0) this.logger.info(`Przetworzono zadań: ${count}`)
      await new Promise((resolve) => setTimeout(resolve, this.interval))
    }
  }
}
