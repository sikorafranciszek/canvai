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
import { recoverStaleJobs, runPendingJobs } from '#services/queue'

const POLL_MS = 1000
const RECOVER_EVERY_MS = 60_000

if (env.get('QUEUE_INLINE_WORKER', true)) {
  let busy = false
  let lastRecover = 0

  const tick = async () => {
    if (busy) return
    busy = true
    try {
      if (Date.now() - lastRecover > RECOVER_EVERY_MS) {
        lastRecover = Date.now()
        await recoverStaleJobs()
      }
      await runPendingJobs(10)
    } catch (error) {
      logger.error({ err: error }, 'queue worker tick failed')
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void tick(), POLL_MS)
  timer.unref()
  app.terminating(() => clearInterval(timer))
}
