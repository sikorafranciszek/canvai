import { createServer, type Server } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { ops } from '#config/ops'
import { S3Client } from '#services/ops/s3'
import { backupDeps, listBackups, pruneBackups, runBackup, storagePath } from '#services/ops/backup'
import { dailyAt, every, registerTask, runDueTasks } from '#services/ops/scheduler'
import { flushAlerts, raiseAlert, resetAlerts, sentAlerts } from '#services/ops/alerts'
import {
  aiBudgetDenial,
  claimGenerationSlot,
  recordAiUsage,
  usageToday,
} from '#services/ops/ai_budget'
import User from '#models/user'

/** Atrapa S3 w pamięci: PUT/GET/DELETE obiektów i ListObjectsV2. */
function fakeS3() {
  const objects = new Map<string, Buffer>()
  const auth: string[] = []
  const server: Server = createServer((req, res) => {
    auth.push(String(req.headers.authorization ?? ''))
    const url = new URL(req.url!, 'http://x')
    const [, bucket, ...rest] = url.pathname.split('/')
    const key = rest.map(decodeURIComponent).join('/')
    if (bucket !== 'bkt') return res.writeHead(404).end()
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        objects.set(key, Buffer.concat(chunks))
        res.writeHead(200).end()
      })
      return
    }
    if (req.method === 'DELETE') {
      objects.delete(key)
      return res.writeHead(204).end()
    }
    if (req.method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') ?? ''
      const items = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(
          ([k, v]) =>
            `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>`
        )
      return res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${items.join('')}</ListBucketResult>`
        )
    }
    if (req.method === 'GET') {
      const body = objects.get(key)
      return body ? res.writeHead(200).end(body) : res.writeHead(404).end()
    }
    res.writeHead(405).end()
  })
  return { server, objects, auth }
}

test.group('Ops — S3 i kopie zapasowe', (group) => {
  const saved = { ...ops.backup }
  let s3: ReturnType<typeof fakeS3>

  group.setup(async () => {
    s3 = fakeS3()
    await new Promise<void>((r) => s3.server.listen(0, '127.0.0.1', () => r()))
    const port = (s3.server.address() as { port: number }).port
    Object.assign(ops.backup, {
      endpoint: `http://127.0.0.1:${port}`,
      bucket: 'bkt',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      prefix: 'canvai/',
      keepDays: 14,
    })
    return () => {
      Object.assign(ops.backup, saved)
      s3.server.close()
    }
  })

  test('podpis SigV4 zgodny z przykładem z dokumentacji AWS', ({ assert }) => {
    const client = new S3Client({
      endpoint: 'https://examplebucket.s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'examplebucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })
    const headers = client.sign(
      'GET',
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      { Range: 'bytes=0-9' },
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      new Date('2013-05-24T00:00:00Z')
    )
    assert.equal(
      headers.authorization,
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })

  test('kopia: zrzut bazy + archiwum plików + manifest; lista i retencja', async ({ assert }) => {
    backupDeps.dumpDatabase = async (file) => writeFile(file, 'PGDMP fake dump')
    await mkdir(storagePath(), { recursive: true })
    await writeFile(join(storagePath(), 'backup-probe.txt'), 'hello')

    const result = await runBackup()
    assert.deepEqual(
      result.files.map((f) => f.key.split('/').pop()),
      ['db.dump', 'storage.tar.gz']
    )
    assert.equal(s3.objects.get(`canvai/${result.id}/db.dump`)?.toString(), 'PGDMP fake dump')
    assert.isTrue(s3.objects.has(`canvai/${result.id}/manifest.json`))
    assert.isTrue(s3.auth.every((a) => a.startsWith('AWS4-HMAC-SHA256 Credential=AK/')))

    // Stara kopia (sprzed 30 dni) jest usuwana, najnowsza zostaje.
    s3.objects.set('canvai/2020-01-01T00-00-00Z/db.dump', Buffer.from('old'))
    assert.lengthOf(await listBackups(), 2)
    assert.equal(await pruneBackups(), 1)
    assert.deepEqual(
      (await listBackups()).map((b) => b.id),
      [result.id]
    )
  })
})

test.group('Ops — harmonogram, alerty i limity AI', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('dailyAt / every', ({ assert }) => {
    const now = DateTime.fromISO('2026-10-01T05:00:00Z').toUTC()
    assert.isTrue(dailyAt(3)(null, now))
    assert.isTrue(dailyAt(3)(DateTime.fromISO('2026-10-01T02:00:00Z').toUTC(), now))
    assert.isFalse(dailyAt(3)(DateTime.fromISO('2026-10-01T03:10:00Z').toUTC(), now))
    assert.isFalse(dailyAt(6)(DateTime.fromISO('2026-09-30T06:30:00Z').toUTC(), now))
    assert.isTrue(every(60)(DateTime.fromISO('2026-10-01T03:59:00Z').toUTC(), now))
  })

  test('zadanie rusza raz w swoim oknie; błąd trafia do alertów', async ({ assert }) => {
    resetAlerts()
    let runs = 0
    registerTask({ name: 'test_task', due: every(60), run: async () => `run ${++runs}` })
    registerTask({
      name: 'test_fail',
      due: every(60),
      run: async () => {
        throw new Error('boom')
      },
    })
    const now = DateTime.utc()
    assert.includeMembers(await runDueTasks(now), ['test_task', 'test_fail'])
    assert.notInclude(await runDueTasks(now.plus({ minutes: 5 })), 'test_task')
    assert.equal(runs, 1)
    const row = await db.from('scheduler_runs').where('task', 'test_fail').first()
    assert.equal(row.last_status, 'failed')

    raiseAlert('x', 'second')
    raiseAlert('x', 'second')
    assert.isTrue(await flushAlerts(true))
    assert.match(sentAlerts[0].text, /task_test_fail.*boom/)
    assert.match(sentAlerts[0].text, /\[x\] second \(×2/)
    assert.isFalse(await flushAlerts(), 'nic nowego do wysłania')
  })

  test('limity dzienne: liczba generacji i tokeny użytkownika', async ({ assert }) => {
    const saved = { ...ops.aiBudget }
    const user = await User.create({
      email: `budget-${Date.now()}@test.com`,
      password: 'password123',
    })
    try {
      Object.assign(ops.aiBudget, {
        userDailyGenerations: 2,
        userDailyTokens: 1000,
        dailyTokens: 0,
      })
      assert.isNull(await aiBudgetDenial(user.id))
      assert.isNull(await claimGenerationSlot(user.id))
      assert.isNull(await claimGenerationSlot(user.id))
      assert.match(String(await claimGenerationSlot(user.id)), /2/)
      assert.equal((await usageToday(user.id)).userGenerations, 2, 'odmowa nie zajmuje miejsca')

      Object.assign(ops.aiBudget, { userDailyGenerations: 0 })
      await recordAiUsage(user.id, { tokensIn: 700, tokensOut: 400 })
      assert.equal((await usageToday(user.id)).userTokens, 1100)
      assert.isNotNull(await aiBudgetDenial(user.id))
    } finally {
      Object.assign(ops.aiBudget, saved)
    }
  })
})
