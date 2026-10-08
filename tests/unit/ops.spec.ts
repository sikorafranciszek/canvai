import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { ops } from '#config/ops'
import { multipart, S3Client } from '#services/ops/s3'
import {
  backupDeps,
  listBackups,
  pruneBackups,
  restoreBackup,
  runBackup,
} from '#services/ops/backup'
import { dailyAt, every, registerTask, runDueTasks } from '#services/ops/scheduler'
import {
  flushAlerts,
  normalizeAlertKey,
  raiseAlert,
  recentAlerts,
  resetAlerts,
  sentAlerts,
} from '#services/ops/alerts'
import {
  aiBudgetDenial,
  claimGenerationSlot,
  recordAiUsage,
  usageToday,
} from '#services/ops/ai_budget'
import User from '#models/user'

/** Atrapa S3 w pamięci: PUT/GET/DELETE, ListObjectsV2 i upload wieloczęściowy. */
function fakeS3() {
  const objects = new Map<string, Buffer>()
  const uploads = new Map<string, Map<number, Buffer>>()
  const auth: string[] = []
  const puts: string[] = []
  const server: Server = createServer((req, res) => {
    auth.push(String(req.headers.authorization ?? ''))
    const url = new URL(req.url!, 'http://x')
    const [, bucket, ...rest] = url.pathname.split('/')
    const key = rest.map(decodeURIComponent).join('/')
    if (bucket !== 'bkt') return res.writeHead(404).end()
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const uploadId = url.searchParams.get('uploadId')
      if (req.method === 'POST' && url.searchParams.has('uploads')) {
        const id = `up-${uploads.size + 1}`
        uploads.set(id, new Map())
        return res
          .writeHead(200)
          .end(
            `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`
          )
      }
      if (req.method === 'PUT' && uploadId) {
        uploads.get(uploadId)!.set(Number(url.searchParams.get('partNumber')), body)
        return res.writeHead(200, { etag: `"etag-${url.searchParams.get('partNumber')}"` }).end()
      }
      if (req.method === 'POST' && uploadId) {
        const parts = [...uploads.get(uploadId)!.entries()].sort(([a], [b]) => a - b)
        objects.set(key, Buffer.concat(parts.map(([, b]) => b)))
        uploads.delete(uploadId)
        puts.push(key)
        return res.writeHead(200).end('<CompleteMultipartUploadResult/>')
      }
      if (req.method === 'PUT') {
        objects.set(key, body)
        puts.push(key)
        return res.writeHead(200).end()
      }
      if (req.method === 'DELETE') {
        if (uploadId) uploads.delete(uploadId)
        else objects.delete(key)
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
        const found = objects.get(key)
        return found ? res.writeHead(200).end(found) : res.writeHead(404).end()
      }
      res.writeHead(405).end()
    })
  })
  return { server, objects, auth, puts, uploads }
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

  test('kopia (REL-2): zrzut bazy, przyrostowe pliki, manifest; retencja i sprzątanie puli', async ({
    assert,
    cleanup,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'canvai-storage-'))
    backupDeps.storageRoot = root
    cleanup(async () => {
      backupDeps.storageRoot = null
      await rm(root, { recursive: true, force: true })
    })
    backupDeps.dumpDatabase = async (file) => writeFile(file, 'PGDMP fake dump')
    await mkdir(join(root, 'boards/1'), { recursive: true })
    await writeFile(join(root, 'a.png'), 'AAA')
    await writeFile(join(root, 'boards/1/b.webp'), 'BBBB')

    const first = await runBackup()
    assert.equal(s3.objects.get(`canvai/${first.id}/db.dump`)?.toString(), 'PGDMP fake dump')
    assert.equal(s3.objects.get('canvai/files/a.png')?.toString(), 'AAA')
    assert.equal(s3.objects.get('canvai/files/boards/1/b.webp')?.toString(), 'BBBB')
    const manifest = JSON.parse(s3.objects.get(`canvai/${first.id}/manifest.json`)!.toString())
    assert.deepEqual(manifest.files.map((f: { path: string }) => f.path).sort(), [
      'a.png',
      'boards/1/b.webp',
    ])
    assert.isTrue(s3.auth.every((a) => a.startsWith('AWS4-HMAC-SHA256 Credential=AK/')))

    // Druga kopia: pliki bez zmian nie są wysyłane ponownie.
    await new Promise((r) => setTimeout(r, 1100))
    s3.puts.length = 0
    const second = await runBackup()
    assert.notInclude(s3.puts.join(' '), 'canvai/files/')
    assert.notEqual(second.id, first.id)
    assert.notInclude(
      (await listBackups()).map((b) => b.id),
      'files',
      'pula plików to nie kopia'
    )

    // Stara kopia usuwana; plik, do którego nikt się nie odwołuje — też.
    s3.objects.set('canvai/2020-01-01T00-00-00Z/db.dump', Buffer.from('old'))
    s3.objects.set('canvai/files/orphan.png', Buffer.from('x'))
    assert.equal(await pruneBackups(), 1)
    assert.isFalse(s3.objects.has('canvai/files/orphan.png'))
    assert.isTrue(s3.objects.has('canvai/files/a.png'))
  })

  test('odtworzenie (REL-2): baza z dumpa, pliki dokładnie jak w kopii', async ({
    assert,
    cleanup,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'canvai-storage-'))
    backupDeps.storageRoot = root
    const restored: string[] = []
    const savedRestore = backupDeps.restoreDatabase
    backupDeps.restoreDatabase = async (file) => {
      restored.push(await readFile(file, 'utf8'))
    }
    cleanup(async () => {
      backupDeps.storageRoot = null
      backupDeps.restoreDatabase = savedRestore
      await rm(root, { recursive: true, force: true })
    })
    backupDeps.dumpDatabase = async (file) => writeFile(file, 'PGDMP round trip')
    await mkdir(join(root, 'boards/2'), { recursive: true })
    await writeFile(join(root, 'boards/2/keep.png'), 'KEEP')
    await writeFile(join(root, 'boards/2/lost.png'), 'LOST')
    const backup = await runBackup()

    // Po awarii: jeden plik zniknął, pojawił się obcy.
    await rm(join(root, 'boards/2/lost.png'))
    await writeFile(join(root, 'boards/2/extra.png'), 'EXTRA')

    const result = await restoreBackup(backup.id)
    assert.deepEqual(restored, ['PGDMP round trip'])
    assert.equal(await readFile(join(root, 'boards/2/lost.png'), 'utf8'), 'LOST')
    assert.equal(await readFile(join(root, 'boards/2/keep.png'), 'utf8'), 'KEEP')
    assert.isFalse(existsSync(join(root, 'boards/2/extra.png')), 'plik spoza kopii usunięty')
    assert.equal(result.restored, 1)
    assert.equal(result.removed, 1)
  })

  test('S3: upload wieloczęściowy dużych plików', async ({ assert, cleanup }) => {
    const saved = { ...multipart }
    Object.assign(multipart, { threshold: 10, partSize: 6 })
    const dir = await mkdtemp(join(tmpdir(), 'canvai-mp-'))
    cleanup(async () => {
      Object.assign(multipart, saved)
      await rm(dir, { recursive: true, force: true })
    })
    const file = join(dir, 'big.bin')
    await writeFile(file, 'abcdefghijklmnopqrstuvw')
    const client = new S3Client({ ...ops.backup, region: 'auto' })
    assert.equal(await client.putFile('canvai/big.bin', file), 23)
    assert.equal(s3.objects.get('canvai/big.bin')?.toString(), 'abcdefghijklmnopqrstuvw')
    assert.equal(s3.uploads.size, 0)
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

  test('alerty (REL-5): klucze bez zmiennych, próg dla błędów użytkownika, zapis w bazie', async ({
    assert,
  }) => {
    resetAlerts()
    assert.equal(
      normalizeAlertKey(
        'log:Generation 123 failed for 3f2b9c1e-1111-2222-3333-444455556666 "Kawiarnia"'
      ),
      normalizeAlertKey('log:Generation 98 failed for 9a9b9c9d-aaaa-bbbb-cccc-ddddeeeeffff "Inna"')
    )
    raiseAlert('log:Generation 1 failed', 'a')
    raiseAlert('log:Generation 2 failed', 'b')
    raiseAlert('design_doc_failed', 'materials problem', { threshold: 3 })
    raiseAlert('design_doc_failed', 'materials problem', { threshold: 3 })
    assert.isTrue(await flushAlerts(true))
    assert.match(sentAlerts[0].text, /Generation # failed.*×2/)
    assert.notInclude(sentAlerts[0].text, 'materials problem', 'poniżej progu — bez wysyłki')

    for (let i = 0; i < 3; i++) raiseAlert('design_doc_failed', 'provider down', { threshold: 3 })
    assert.isTrue(await flushAlerts(true))
    assert.include(sentAlerts[0].text, 'provider down')

    for (let i = 0; i < 60; i++) raiseAlert(`distinct-${'x'.repeat(i)}`, `m${i}`)
    await flushAlerts(true)
    assert.match(sentAlerts[0].text, /More than 50 distinct alerts/)

    await new Promise((r) => setTimeout(r, 300))
    const log = await recentAlerts(100)
    const doc = log.find((a) => a.key === 'design_doc_failed')
    assert.equal(doc?.count, 5, 'w bazie każde wystąpienie, także poniżej progu')
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
