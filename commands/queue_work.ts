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

    const { startQueueWorker } = await import('#services/queue_worker')
    const concurrency = Number(process.env.QUEUE_CONCURRENCY ?? 3)
    const worker = startQueueWorker({
      concurrency,
      pollMs: this.interval,
      onBatch: (count) => this.logger.info(`Przetworzono zadań: ${count}`),
    })
    this.logger.info(`Worker kolejki działa: ${concurrency} + 1 (podglądy) (Ctrl+C aby zakończyć)`)
    await new Promise<void>((resolve) => {
      this.app.terminating(async () => {
        const released = await worker.stop(20_000)
        if (released) this.logger.info(`Oddano do kolejki: ${released}`)
        resolve()
      })
    })
  }
}
