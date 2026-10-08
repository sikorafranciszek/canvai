import logger from '@adonisjs/core/services/logger'
import {
  QUEUE_LANES,
  recoverStaleJobs,
  releaseOwnedJobs,
  runPendingJobs,
  type QueueLane,
} from '#services/queue'

/**
 * Pętla workera kolejki (ARC-1) — wspólna dla workera in-process
 * (`start/worker.ts`) i `node ace queue:work`.
 *
 * Kilka niezależnych slotów: `concurrency` slotów toru ogólnego (generacje
 * i inne zadania) + jeden slot podglądów. Jedna kilkuminutowa generacja nie
 * blokuje więc innych użytkowników, a podgląd nie czeka za generacjami.
 */

export interface WorkerSlot {
  lane: QueueLane
  /** Kiedy slot zaczął bieżącą partię zadań; 0 = wolny. */
  busySince: number
}

export interface QueueWorker {
  slots: WorkerSlot[]
  /** Najstarsza trwająca partia (do kontroli zdrowia); 0 = bezczynny. */
  busySince(): number
  /** Zatrzymuje odpytywanie, czeka na bieżące zadania do `graceMs`, resztę oddaje do kolejki. */
  stop(graceMs: number): Promise<number>
}

export function startQueueWorker(
  opts: {
    concurrency?: number
    pollMs?: number
    recoverEveryMs?: number
    /** Wywoływane przy każdym tyknięciu z czasem najstarszej trwającej partii (0 = bezczynny). */
    onTick?: (busySince: number) => void
    onBatch?: (count: number) => void
  } = {}
): QueueWorker {
  const concurrency = Math.max(1, Math.min(16, opts.concurrency ?? 3))
  const slots: WorkerSlot[] = [
    ...Array.from({ length: concurrency }, () => ({ lane: QUEUE_LANES.general, busySince: 0 })),
    { lane: QUEUE_LANES.preview, busySince: 0 },
  ]
  let recovering = false
  let lastRecover = 0
  const recoverEvery = opts.recoverEveryMs ?? 60_000

  const busySince = () => {
    const active = slots.map((s) => s.busySince).filter(Boolean)
    return active.length ? Math.min(...active) : 0
  }

  const tick = () => {
    opts.onTick?.(busySince())
    if (!recovering && Date.now() - lastRecover > recoverEvery) {
      recovering = true
      lastRecover = Date.now()
      void recoverStaleJobs()
        .catch((error) => logger.error({ err: error }, 'queue recovery failed'))
        .finally(() => (recovering = false))
    }
    for (const slot of slots) {
      if (slot.busySince) continue
      slot.busySince = Date.now()
      void runPendingJobs(10, slot.lane)
        .then((count) => count && opts.onBatch?.(count))
        .catch((error) => logger.error({ err: error }, 'queue worker tick failed'))
        .finally(() => {
          slot.busySince = 0
        })
    }
  }

  const timer = setInterval(tick, opts.pollMs ?? 1000)
  timer.unref()
  tick()

  return {
    slots,
    busySince,
    async stop(graceMs) {
      clearInterval(timer)
      const deadline = Date.now() + graceMs
      while (slots.some((s) => s.busySince) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      return releaseOwnedJobs().catch(() => 0)
    },
  }
}
