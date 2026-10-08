import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import { limits } from '#config/ai'
import DesignDoc from '#models/design_doc'
import DesignPreview from '#models/design_preview'
import { runPreview } from '#services/design/preview'
import { releaseAll } from '#services/billing/credits'
import Job from '#models/job'
import { AiProviderError } from '#services/ai/types'
import { runGeneration } from '#services/design/generator'
import { runWithLocale, t } from '#services/i18n'
import { isLocale } from '#shared/i18n'
import { track } from '#services/analytics/collector'
import Board from '#models/board'
import { raiseAlert } from '#services/ops/alerts'
import { publish } from '#services/board_events'

/**
 * Kolejka zadań na tabeli `jobs` (bez Redisa). Worker in-process
 * (`start/worker.ts`) albo `node ace queue:work` woła `runPendingJobs()`.
 *
 * - `claimNext` przejmuje zadanie warunkowym UPDATE (status = queued), więc
 *   dwa workery nie wezmą tego samego zadania.
 * - Błąd ponawialny (np. 429/timeout dostawcy) wraca do kolejki z backoffem
 *   (`run_at`), do `limits.maxRetries` prób; inny kończy zadanie jako `failed`.
 * - Zadanie `running` z przeterminowanym `locked_at` (np. restart serwera)
 *   jest odzyskiwane przez `recoverStaleJobs`.
 */

export interface JobContext {
  progress(progress: Record<string, unknown>): Promise<void>
}

export interface JobHandler {
  run(job: Job, ctx: JobContext): Promise<void>
  /** Wywoływane, gdy zadanie ostatecznie się nie powiodło. */
  onFailed(job: Job, message: string): Promise<void>
  /** Wywoływane, gdy zadanie wraca do kolejki po błędzie ponawialnym. */
  onRetry?(job: Job, message: string): Promise<void>
}

export const JOB_GENERATE_DESIGN_DOC = 'generate_design_doc'
export const JOB_GENERATE_PREVIEW = 'generate_preview'

const handlers: Record<string, JobHandler> = {
  [JOB_GENERATE_DESIGN_DOC]: {
    async run(job, ctx) {
      const doc = await DesignDoc.findOrFail(job.payload.designDocId as number)
      await runGeneration(doc, (p) => ctx.progress(p as unknown as Record<string, unknown>))
    },
    async onFailed(job, message) {
      const docId = job.payload.designDocId as number
      await DesignDoc.query().where('id', docId).update({ status: 'failed', error: message })
      const board = await Board.find(job.payload.boardId as number)
      track(
        'design_doc_failed',
        { error: message.slice(0, 300), attempts: job.attempts },
        {
          userId: board?.userId ?? null,
          boardId: board?.id ?? null,
        }
      )
      // Nieudana generacja nic nie kosztuje — rezerwacja wraca w całości.
      await releaseAll({ designDocId: docId })
      // Pojedyncza porażka bywa winą materiałów — alarm dopiero przy serii (REL-5).
      raiseAlert('design_doc_failed', `DESIGN.md generation failed (doc ${docId}): ${message}`, {
        threshold: 3,
      })
      if (board) publish(board.id, 'doc', { status: 'failed' })
    },
    async onRetry(job, message) {
      await DesignDoc.query()
        .where('id', job.payload.designDocId as number)
        .update({ status: 'queued', error: t('gen.retrying', { message }) })
    },
  },
  [JOB_GENERATE_PREVIEW]: {
    async run(job) {
      const preview = await DesignPreview.findOrFail(job.payload.previewId as number)
      await runPreview(preview)
    },
    async onFailed(job, message) {
      const previewId = job.payload.previewId as number
      await DesignPreview.query()
        .where('id', previewId)
        .update({ status: 'failed', error: message })
      const board = await Board.find(job.payload.boardId as number)
      track(
        'preview_failed',
        { error: message.slice(0, 300) },
        {
          userId: board?.userId ?? null,
          boardId: board?.id ?? null,
        }
      )
      await releaseAll({ designPreviewId: previewId }, 'preview failed')
      raiseAlert('preview_failed', `UI preview failed (preview ${previewId}): ${message}`, {
        threshold: 3,
      })
    },
    async onRetry(job) {
      await DesignPreview.query()
        .where('id', job.payload.previewId as number)
        .update({ status: 'queued' })
    },
  },
}

/** Rejestracja typu zadania (testy, przyszłe zadania). Zwraca poprzedni handler. */
export function registerJobHandler(type: string, handler: JobHandler): JobHandler | undefined {
  const previous = handlers[type]
  handlers[type] = handler
  return previous
}

function sqlTime(dt: DateTime): string {
  return dt.toUTC().toFormat(db.connection().dialect.dateTimeFormat)
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  trx?: TransactionClientContract
): Promise<Job> {
  if (!handlers[type]) throw new Error(`Nieznany typ zadania: ${type}`)
  return Job.create(
    { type, payload, status: 'queued', attempts: 0, runAt: null, lockedAt: null },
    trx ? { client: trx } : undefined
  )
}

/** Co ile odświeżana jest blokada trwającego zadania (heartbeat). */
const HEARTBEAT_MS = 30_000

/** Zadania trzymane przez ten proces (token → id) — do zwolnienia przy zamykaniu. */
const owned = new Map<string, number>()

/** Filtr toru: tylko te typy (`only`) albo wszystkie poza (`except`). */
export interface QueueLane {
  only?: readonly string[]
  except?: readonly string[]
}

/**
 * Tory kolejki (ARC-1): podglądy mają własny tor i nie czekają za kilkuminutowymi
 * generacjami; tor ogólny bierze wszystko inne (także przyszłe typy zadań).
 */
export const QUEUE_LANES = {
  general: { except: [JOB_GENERATE_PREVIEW] },
  preview: { only: [JOB_GENERATE_PREVIEW] },
} satisfies Record<string, QueueLane>

export async function claimNext(lane: QueueLane = {}): Promise<Job | null> {
  const now = DateTime.utc()
  const query = Job.query()
    .where('status', 'queued')
    .where((q) => q.whereNull('run_at').orWhere('run_at', '<=', sqlTime(now)))
  if (lane.only?.length) query.whereIn('type', [...lane.only])
  if (lane.except?.length) query.whereNotIn('type', [...lane.except])
  const candidates = await query.orderBy('id', 'asc').limit(5)

  for (const candidate of candidates) {
    const token = randomUUID()
    const affected = await db
      .from('jobs')
      .where('id', candidate.id)
      .where('status', 'queued')
      .update({
        status: 'running',
        locked_at: sqlTime(now),
        locked_by: token,
        attempts: candidate.attempts + 1,
      })
    const count = Array.isArray(affected) ? Number(affected[0]) : Number(affected)
    if (count === 1) return Job.find(candidate.id)
  }
  return null
}

/**
 * Zmiana stanu zadania tylko przez proces, który je trzyma (DAT-3). Zwraca
 * `false`, gdy zadanie zostało w międzyczasie odzyskane przez inny proces —
 * wtedy wynik tego wykonania jest porzucany (bez podwójnych zwrotów/opłat).
 */
async function updateOwned(job: Job, token: string, fields: Record<string, unknown>) {
  const affected = await db
    .from('jobs')
    .where('id', job.id)
    .where('locked_by', token)
    .update({ ...fields, updated_at: new Date() })
  return (Array.isArray(affected) ? Number(affected[0]) : Number(affected)) === 1
}

/** Zadanie wykonuje się w języku użytkownika, który je zlecił (payload.locale). */
export async function runJob(job: Job): Promise<void> {
  const locale = isLocale(job.payload?.locale) ? job.payload.locale : undefined
  return locale ? runWithLocale(locale, () => runJobInner(job)) : runJobInner(job)
}

async function runJobInner(job: Job): Promise<void> {
  const handler = handlers[job.type]
  const token = job.lockedBy ?? ''
  if (!handler) {
    await updateOwned(job, token, {
      status: 'failed',
      last_error: `Unknown job type: ${job.type}`,
      locked_by: null,
    })
    return
  }

  owned.set(token, job.id)
  // Heartbeat: długie wywołanie modelu (kilka minut) nie wygląda na porzucone.
  const heartbeat = setInterval(() => {
    void updateOwned(job, token, { locked_at: sqlTime(DateTime.utc()) }).catch(() => {})
  }, HEARTBEAT_MS)
  heartbeat.unref()

  const ctx: JobContext = {
    async progress(progress) {
      job.payload = { ...job.payload, progress }
      await updateOwned(job, token, {
        payload: JSON.stringify(job.payload),
        locked_at: sqlTime(DateTime.utc()),
      })
    },
  }

  try {
    try {
      await handler.run(job, ctx)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('gen.unexpected')
      const retryable = error instanceof AiProviderError && error.retryable

      if (!(error instanceof AiProviderError)) {
        logger.error({ err: error, jobId: job.id }, 'job failed with unexpected error')
      }

      if (retryable && job.attempts < limits.maxRetries) {
        const runAt = DateTime.utc().plus({ seconds: 5 * 2 ** job.attempts })
        if (
          await updateOwned(job, token, {
            status: 'queued',
            last_error: message,
            locked_at: null,
            locked_by: null,
            run_at: sqlTime(runAt),
          })
        ) {
          await handler.onRetry?.(job, message)
        }
        return
      }

      if (
        await updateOwned(job, token, {
          status: 'failed',
          last_error: message,
          locked_at: null,
          locked_by: null,
        })
      ) {
        await handler.onFailed(job, message)
      } else {
        logger.warn({ jobId: job.id }, 'job lost its lock before failing — result discarded')
      }
      return
    }

    if (
      !(await updateOwned(job, token, {
        status: 'done',
        last_error: null,
        locked_at: null,
        locked_by: null,
      }))
    ) {
      logger.warn({ jobId: job.id }, 'job lost its lock before finishing')
    }
  } finally {
    clearInterval(heartbeat)
    owned.delete(token)
  }
}

/**
 * Przy zamykaniu procesu (deploy): zadania, których nie zdążyliśmy skończyć,
 * wracają od razu do kolejki zamiast czekać na odzyskanie po 10 minutach.
 */
export async function releaseOwnedJobs(): Promise<number> {
  let released = 0
  for (const [token, id] of owned) {
    const affected = await db.from('jobs').where('id', id).where('locked_by', token).update({
      status: 'queued',
      locked_at: null,
      locked_by: null,
      run_at: null,
      last_error: 'Interrupted by restart',
      updated_at: new Date(),
    })
    if ((Array.isArray(affected) ? Number(affected[0]) : Number(affected)) === 1) released++
    owned.delete(token)
  }
  return released
}

/** Uruchamia zadania gotowe do wykonania, jedno po drugim. Zwraca ich liczbę. */
export async function runPendingJobs(
  max = Number.POSITIVE_INFINITY,
  lane: QueueLane = {}
): Promise<number> {
  let count = 0
  while (count < max) {
    const job = await claimNext(lane)
    if (!job) break
    await runJob(job)
    count++
  }
  return count
}

/** Zwraca do kolejki zadania porzucone w stanie `running` (np. po restarcie). */
export async function recoverStaleJobs(): Promise<number> {
  const threshold = DateTime.utc().minus({ milliseconds: limits.jobLockTimeoutMs })
  const stale = await Job.query()
    .where('status', 'running')
    .where('locked_at', '<', sqlTime(threshold))

  for (const job of stale) {
    const locale = isLocale(job.payload?.locale) ? job.payload.locale : 'pl'
    await runWithLocale(locale, () => recoverOne(job))
  }
  return stale.length
}

async function recoverOne(job: Job): Promise<void> {
  // Przejęcie warunkowe: tylko jeśli nikt w międzyczasie nie odświeżył blokady.
  const threshold = DateTime.utc().minus({ milliseconds: limits.jobLockTimeoutMs })
  const retry = job.attempts < limits.maxRetries
  const affected = await db
    .from('jobs')
    .where('id', job.id)
    .where('status', 'running')
    .where('locked_at', '<', sqlTime(threshold))
    .update({
      status: retry ? 'queued' : 'failed',
      locked_at: null,
      locked_by: null,
      last_error: retry ? t('gen.interruptedRetry') : t('gen.interruptedTooMany'),
      updated_at: new Date(),
    })
  if ((Array.isArray(affected) ? Number(affected[0]) : Number(affected)) !== 1) return
  if (retry) await handlers[job.type]?.onRetry?.(job, t('gen.interruptedRetry'))
  else await handlers[job.type]?.onFailed(job, t('gen.interrupted'))
}
