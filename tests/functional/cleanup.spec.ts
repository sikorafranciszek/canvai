import { DateTime } from 'luxon'
import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'
import Asset from '#models/asset'
import Board from '#models/board'
import BoardComment from '#models/board_comment'
import User from '#models/user'
import { sweepOrphanFiles } from '#services/assets_service'

async function login(client: any) {
  const user = await User.create({
    emailVerifiedAt: DateTime.utc(),
    email: `clean-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    password: 'password123',
  })
  const res = await client
    .post('/login')
    .json({ email: user.email, password: 'password123' })
    .redirects(0)
  return { user, cookies: res.headers()['set-cookie'] }
}

test.group('Sprzątanie danych (DAT-6, DAT-8)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('usunięcie tablicy usuwa pliki materiałów z dysku', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await Board.create({ title: 'Del', slug: `del-${Date.now()}`, userId: user.id })
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#c0622d' },
    })
      .png()
      .toBuffer()
    const up = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', png, { filename: 'a.png', contentType: 'image/png' })
    up.assertStatus(201)
    const asset = await Asset.findOrFail(up.body().data[0].id)
    const keys = [asset.storageKey, asset.thumbKey, asset.analysisKey].filter(Boolean) as string[]
    assert.isAbove(keys.length, 1)
    for (const k of keys) assert.isTrue(await drive.use().exists(k))

    await client.delete(`/boards/${board.id}`).headers({ cookie: cookies }).redirects(0)
    assert.isNull(await Board.find(board.id))
    for (const k of keys) assert.isFalse(await drive.use().exists(k), k)
  })

  test('komentarze: zwracane są najnowsze (po przekroczeniu 1000)', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await Board.create({ title: 'C', slug: `c-${Date.now()}`, userId: user.id })
    const base = Date.now() - 2000 * 1000
    await db.table('board_comments').multiInsert(
      Array.from({ length: 1001 }, (_, i) => ({
        board_id: board.id,
        user_id: user.id,
        x: 0,
        y: 0,
        body: `c${i}`,
        created_at: new Date(base + i * 1000),
      }))
    )
    const res = await client.get(`/api/boards/${board.id}/comments`).headers({ cookie: cookies })
    const bodies = res.body().data.map((c: any) => c.body)
    assert.lengthOf(bodies, 1000)
    assert.equal(bodies[bodies.length - 1], 'c1000', 'najnowszy widoczny')
    assert.equal(bodies[0], 'c1', 'chronologicznie')
    assert.equal(
      await BoardComment.query()
        .where('board_id', board.id)
        .count('* as n')
        .then((r) => Number(r[0].$extras.n)),
      1001
    )
  })

  test('cotygodniowe sprzątanie usuwa stare pliki bez wiersza, zostawia świeże i znane', async ({
    assert,
  }) => {
    await drive.use().put('boards/999999/assets/orphan-old.png', 'x')
    await drive.use().put('boards/999999/assets/orphan-new.png', 'x')
    const old = new Date(Date.now() - 10 * 24 * 3600_000)
    await utimes(join(app.tmpPath('test-storage'), 'boards/999999/assets/orphan-old.png'), old, old)
    const removed = await sweepOrphanFiles()
    assert.isAtLeast(removed, 1)
    assert.isFalse(await drive.use().exists('boards/999999/assets/orphan-old.png'))
    assert.isTrue(await drive.use().exists('boards/999999/assets/orphan-new.png'))
    await drive.use().deleteAll('boards/999999')
  })
})
