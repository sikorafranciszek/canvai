import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import {
  claimNext,
  enqueue,
  recoverStaleJobs,
  registerJobHandler,
  releaseOwnedJobs,
  runJob,
  runPendingJobs,
} from '#services/queue'
import { AiProviderError } from '#services/ai/types'

const calls = { failed: 0, retried: 0 }
let behaviour: (job: Job) => Promise<void> = async () => {}
registerJobHandler('test_job', {
  run: (job) => behaviour(job),
  async onFailed() {
    calls.failed++
  },
  async onRetry() {
    calls.retried++
  },
})

test.group('Kolejka: cykl życia i własność zadania (DAT-3)', (group) => {
  group.each.setup(() => {
    calls.failed = 0
    calls.retried = 0
    behaviour = async () => {}
    return testUtils.db().withGlobalTransaction()
  })

  test('udane zadanie kończy się done i zwalnia blokadę', async ({ assert }) => {
    const job = await enqueue('test_job', {})
    assert.equal(await runPendingJobs(1), 1)
    await job.refresh()
    assert.equal(job.status, 'done')
    assert.isNull(job.lockedBy)
  })

  test('błąd ponawialny wraca do kolejki z backoffem; nieponawialny → failed + onFailed', async ({
    assert,
  }) => {
    behaviour = async () => {
      throw new AiProviderError('rate limited', true)
    }
    const retry = await enqueue('test_job', {})
    await runPendingJobs(1)
    await retry.refresh()
    assert.equal(retry.status, 'queued')
    assert.isNotNull(retry.runAt)
    assert.equal(calls.retried, 1)

    behaviour = async () => {
      throw new AiProviderError('bad request', false)
    }
    await db.from('jobs').where('id', retry.id).update({ run_at: null })
    await runPendingJobs(1)
    await retry.refresh()
    assert.equal(retry.status, 'failed')
    assert.equal(calls.failed, 1)
  })

  test('zadanie przejęte przez inny proces: wynik porzucony, bez podwójnego onFailed', async ({
    assert,
  }) => {
    const job = await enqueue('test_job', {})
    const claimed = (await claimNext())!
    behaviour = async () => {
      // W trakcie wykonania inny proces odzyskuje zadanie (np. po przekroczeniu blokady).
      await db
        .from('jobs')
        .where('id', job.id)
        .update({ locked_by: 'someone-else', status: 'running' })
      throw new AiProviderError('boom', false)
    }
    await runJob(claimed)
    await job.refresh()
    assert.equal(job.lockedBy, 'someone-else')
    assert.equal(job.status, 'running')
    assert.equal(calls.failed, 0)
  })

  test('odzyskanie dotyczy tylko zadań z wygasłą blokadą (nie trwających)', async ({ assert }) => {
    const fresh = await enqueue('test_job', {})
    await claimNext()
    assert.equal(await recoverStaleJobs(), 0)
    await fresh.refresh()
    assert.equal(fresh.status, 'running')

    await db
      .from('jobs')
      .where('id', fresh.id)
      .update({ locked_at: new Date(Date.now() - 60 * 60_000) })
    await recoverStaleJobs()
    await fresh.refresh()
    assert.equal(fresh.status, 'queued')
    assert.isNull(fresh.lockedBy)
    assert.equal(calls.retried, 1)
  })

  test('zamykanie procesu oddaje trwające zadanie do kolejki', async ({ assert }) => {
    const job = await enqueue('test_job', {})
    let release!: () => void
    behaviour = () => new Promise<void>((r) => (release = r))
    const claimed = (await claimNext())!
    const running = runJob(claimed)
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(await releaseOwnedJobs(), 1)
    await job.refresh()
    assert.equal(job.status, 'queued')
    release()
    await running
    await job.refresh()
    assert.equal(job.status, 'queued', 'zakończenie po oddaniu nie nadpisuje stanu')
  })
})

test.group('Kolejka: równoległe sloty i tor podglądów (ARC-1)', () => {
  test('dwa zadania wykonują się równolegle; podgląd nie czeka za generacjami', async ({
    assert,
    cleanup,
  }) => {
    const { startQueueWorker } = await import('#services/queue_worker')
    const { JOB_GENERATE_PREVIEW } = await import('#services/queue')
    let running = 0
    let peak = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const seen: string[] = []
    registerJobHandler('test_parallel', {
      async run(job) {
        running++
        peak = Math.max(peak, running)
        seen.push(`start:${job.id}`)
        await gate
        running--
      },
      async onFailed() {},
    })
    // Podgląd w teście: zastępczy handler (bez modelu), na torze podglądów.
    let previewRan = false
    const original = registerJobHandler(JOB_GENERATE_PREVIEW, {
      async run() {
        previewRan = true
      },
      async onFailed() {},
    })
    cleanup(() => {
      if (original) registerJobHandler(JOB_GENERATE_PREVIEW, original)
    })

    const jobs = [
      await enqueue('test_parallel', {}),
      await enqueue('test_parallel', {}),
      await enqueue(JOB_GENERATE_PREVIEW, {}),
    ]
    cleanup(async () => {
      await db
        .from('jobs')
        .whereIn(
          'id',
          jobs.map((j) => j.id)
        )
        .delete()
    })

    const worker = startQueueWorker({ concurrency: 2, pollMs: 50 })
    const deadline = Date.now() + 5000
    while ((peak < 2 || !previewRan) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(peak, 2, 'oba zadania jednocześnie')
    assert.isTrue(previewRan, 'podgląd wykonany, choć sloty ogólne są zajęte')
    release()
    await worker.stop(3000)
    const statuses = await db
      .from('jobs')
      .whereIn(
        'id',
        jobs.map((j) => j.id)
      )
      .select('status')
    assert.deepEqual(
      statuses.map((s) => s.status),
      ['done', 'done', 'done']
    )
  }).timeout(15_000)
})
