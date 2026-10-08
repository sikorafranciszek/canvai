import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { deepHealth, workerPulse } from '#services/ops/health'

test.group('Health check (REL-1)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('/health/deep bez tokenu zwraca tylko status', async ({ client, assert }) => {
    const res = await client.get('/health/deep')
    assert.oneOf(res.status(), [200, 503])
    assert.deepEqual(Object.keys(res.body()), ['status'])
  })

  test('wykrywa zawieszony worker i zablokowane zadania', async ({ assert }) => {
    const saved = { ...workerPulse }
    try {
      Object.assign(workerPulse, {
        enabled: true,
        lastTickAt: Date.now() - 5 * 60_000,
        busySince: 0,
      })
      await db.table('jobs').insert({
        type: 'generate_design_doc',
        payload: JSON.stringify({}),
        status: 'running',
        attempts: 1,
        locked_at: new Date(Date.now() - 60 * 60_000),
        created_at: new Date(),
        updated_at: new Date(),
      })
      const result = await deepHealth()
      assert.equal(result.status, 'fail')
      assert.equal(result.checks.worker.status, 'fail')
      assert.equal(result.checks.queue.status, 'fail')
      assert.match(result.checks.queue.detail, /1 stuck/)
      assert.equal(result.checks.database.status, 'ok')
      assert.include(['ok', 'degraded'], result.checks.disk.status)
    } finally {
      Object.assign(workerPulse, saved)
    }
  })
})
