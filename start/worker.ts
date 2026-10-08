/*
|--------------------------------------------------------------------------
| Worker kolejki (in-process)
|--------------------------------------------------------------------------
|
| Ładowany tylko w środowisku `web` (patrz adonisrc.ts), więc `npm run dev`
| od razu przetwarza generacje DESIGN.md bez osobnego procesu. Na produkcji
| z wieloma instancjami można go wyłączyć (QUEUE_INLINE_WORKER=false) i
| uruchomić osobno `node ace queue:work`.
|
*/

import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { startQueueWorker } from '#services/queue_worker'
import { runDueTasks } from '#services/ops/scheduler'
import { flushAlerts } from '#services/ops/alerts'
import '#services/ops/tasks'
import { workerPulse } from '#services/ops/health'
import { closeAll as closeLiveStreams } from '#services/board_events'

const POLL_MS = 1000
const RECOVER_EVERY_MS = 60_000
const SCHEDULER_EVERY_MS = 60_000
/** Ile czekać na bieżące zadanie przy zamykaniu (krócej niż stop_grace_period). */
const SHUTDOWN_GRACE_MS = 20_000

/** Tylko proces serwera HTTP (bin/server.ts), nie polecenia ace w trybie web. */
const isHttpServer = process.env.CANVAI_HTTP_SERVER === '1'

if (isHttpServer) {
  if (env.get('QUEUE_INLINE_WORKER', true)) {
    workerPulse.enabled = true
    const worker = startQueueWorker({
      concurrency: env.get('QUEUE_CONCURRENCY', 3),
      pollMs: POLL_MS,
      recoverEveryMs: RECOVER_EVERY_MS,
      onTick: (busySince) => {
        workerPulse.lastTickAt = Date.now()
        // Zdrowie: „zajęty od” = najstarsze trwające zadanie, 0 = bezczynny.
        workerPulse.busySince = busySince
      },
    })
    // Zamykanie (deploy): czekamy chwilę na bieżące zadania, resztę oddajemy do kolejki.
    app.terminating(async () => {
      const released = await worker.stop(SHUTDOWN_GRACE_MS)
      if (released) logger.info({ released }, 'jobs returned to queue on shutdown')
    })
  }

  /**
   * Zadania cykliczne (kopie zapasowe, maile) i wysyłka zebranych alertów.
   * Osobna pętla — długa kopia zapasowa nie blokuje kolejki generacji.
   */
  {
    let busy = false
    const schedule = async () => {
      if (busy) return
      busy = true
      try {
        await runDueTasks()
      } catch (error) {
        logger.warn({ err: error }, 'scheduler tick failed')
      } finally {
        busy = false
      }
    }
    const scheduler = setInterval(() => {
      void schedule()
      void flushAlerts().catch((error) => logger.warn({ err: error }, 'alerts flush failed'))
    }, SCHEDULER_EVERY_MS)
    scheduler.unref()
    app.terminating(async () => {
      clearInterval(scheduler)
      await flushAlerts(true).catch(() => {})
    })
  }

  // Strumienie na żywo nie mogą blokować zamknięcia serwera HTTP przy deployu.
  app.terminating(() => {
    const closed = closeLiveStreams()
    if (closed) logger.info({ closed }, 'live streams closed on shutdown')
  })
}
