import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
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

interface JobHandler {
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
      // Nieudana generacja nic nie kosztuje — rezerwacja wraca w całości.
      await releaseAll({ designDocId: docId })
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
      await DesignPreview.query().where('id', previewId).update({ status: 'failed', error: message })
      await releaseAll({ designPreviewId: previewId }, 'preview failed')
    },
    async onRetry(job) {
      await DesignPreview.query()
        .where('id', job.payload.previewId as number)
        .update({ status: 'queued' })
    },
  },
}

function sqlTime(dt: DateTime): string {
  return dt.toUTC().toFormat(db.connection().dialect.dateTimeFormat)
}

export async function enqueue(type: string, payload: Record<string, unknown>): Promise<Job> {
  if (!handlers[type]) throw new Error(`Nieznany typ zadania: ${type}`)
  return Job.create({ type, payload, status: 'queued', attempts: 0, runAt: null, lockedAt: null })
}

export async function claimNext(): Promise<Job | null> {
  const now = DateTime.utc()
  const candidates = await Job.query()
    .where('status', 'queued')
    .where((q) => q.whereNull('run_at').orWhere('run_at', '<=', sqlTime(now)))
    .orderBy('id', 'asc')
    .limit(5)

  for (const candidate of candidates) {
    const affected = await db
      .from('jobs')
      .where('id', candidate.id)
      .where('status', 'queued')
      .update({
        status: 'running',
        locked_at: sqlTime(now),
        attempts: candidate.attempts + 1,
      })
    const count = Array.isArray(affected) ? Number(affected[0]) : Number(affected)
    if (count === 1) return Job.find(candidate.id)
  }
  return null
}

/** Zadanie wykonuje się w języku użytkownika, który je zlecił (payload.locale). */
export async function runJob(job: Job): Promise<void> {
  const locale = isLocale(job.payload?.locale) ? job.payload.locale : undefined
  return locale ? runWithLocale(locale, () => runJobInner(job)) : runJobInner(job)
}

async function runJobInner(job: Job): Promise<void> {
  const handler = handlers[job.type]
  if (!handler) {
    job.merge({ status: 'failed', lastError: `Unknown job type: ${job.type}` })
    await job.save()
    return
  }

  const ctx: JobContext = {
    async progress(progress) {
      job.payload = { ...job.payload, progress }
      job.lockedAt = DateTime.utc()
      await job.save()
    },
  }

  try {
    await handler.run(job, ctx)
    job.merge({ status: 'done', lastError: null, lockedAt: null })
    await job.save()
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : t('gen.unexpected')
    const retryable = error instanceof AiProviderError && error.retryable

    if (!(error instanceof AiProviderError)) {
      logger.error({ err: error, jobId: job.id }, 'job failed with unexpected error')
    }

    if (retryable && job.attempts < limits.maxRetries) {
      job.merge({
        status: 'queued',
        lastError: message,
        lockedAt: null,
        runAt: DateTime.utc().plus({ seconds: 5 * 2 ** job.attempts }),
      })
      await job.save()
      await handler.onRetry?.(job, message)
      return
    }

    job.merge({ status: 'failed', lastError: message, lockedAt: null })
    await job.save()
    await handler.onFailed(job, message)
  }
}

/** Uruchamia zadania gotowe do wykonania, jedno po drugim. Zwraca ich liczbę. */
export async function runPendingJobs(max = Number.POSITIVE_INFINITY): Promise<number> {
  let count = 0
  while (count < max) {
    const job = await claimNext()
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
  if (job.attempts < limits.maxRetries) {
    job.merge({ status: 'queued', lockedAt: null, lastError: t('gen.interruptedRetry') })
    await job.save()
    await handlers[job.type]?.onRetry?.(job, t('gen.interruptedRetry'))
  } else {
    job.merge({ status: 'failed', lockedAt: null, lastError: t('gen.interruptedTooMany') })
    await job.save()
    await handlers[job.type]?.onFailed(job, t('gen.interrupted'))
  }
}
