import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import { rm } from 'node:fs/promises'
import sharp from 'sharp'
import User from '#models/user'
import Board from '#models/board'
import Asset from '#models/asset'

test.group('Assets API', (group) => {
  group.each.setup(async () => {
    await rm(app.makePath('storage'), { recursive: true, force: true })
    return testUtils.db().withGlobalTransaction()
  })

  async function login(client: any) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({
      email: `asset-test-${suffix}@test.com`,
      password: 'password123',
    })
    const loginResp = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    return { user, cookies: loginResp.headers()['set-cookie'] }
  }

  async function createBoard(user: any) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return Board.create({
      title: 'Assets',
      slug: `assets-${suffix}`,
      userId: user.id,
    })
  }

  function pngBuffer(seed: number): Promise<Buffer> {
    return sharp({
      create: {
        width: 24 + seed,
        height: 24 + seed,
        channels: 4,
        background: { r: (seed * 25) % 255, g: 30, b: 60, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
  }

  test('upload 10 plików naraz + miniatury', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    let req = client.post(`/api/boards/${board.id}/assets`).headers({ cookie: cookies })
    for (let i = 0; i < 10; i++) {
      req = req.file('files', await pngBuffer(i), {
        filename: `img-${i}.png`,
        contentType: 'image/png',
      })
    }
    const response = await req
    response.assertStatus(201)

    const assets = response.body().data
    assert.lengthOf(assets, 10)

    for (const asset of assets) {
      assert.equal(asset.kind, 'image')
      assert.isString(asset.sha256)
      assert.isNumber(asset.width)
      assert.isNumber(asset.height)
      assert.match(asset.urls.thumb, /\/thumb$/)
    }

    const stored = await Asset.query().where('board_id', board.id)
    assert.lengthOf(stored, 10)
  })

  test('deduplikacja po sha256 w obrębie tablicy', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)
    const buffer = await pngBuffer(0)

    const first = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', buffer, { filename: 'same.png', contentType: 'image/png' })
    first.assertStatus(201)

    const second = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', buffer, { filename: 'same-again.png', contentType: 'image/png' })
    second.assertStatus(201)

    assert.equal(first.body().data[0].id, second.body().data[0].id)
    assert.equal(first.body().data[0].sha256, second.body().data[0].sha256)

    const stored = await Asset.query().where('board_id', board.id)
    assert.lengthOf(stored, 1)
  })

  test('odrzuca niebezpieczny typ MIME (HTML)', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const response = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', Buffer.from('<html><body>xss</body></html>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      })
    response.assertStatus(422)

    const stored = await Asset.query().where('board_id', board.id)
    assert.lengthOf(stored, 0)
  })

  test('raw i thumb tylko dla właściciela tablicy', async ({ client }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const upload = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', await pngBuffer(1), { filename: 'owner.png', contentType: 'image/png' })
    upload.assertStatus(201)
    const asset = upload.body().data[0]

    const raw = await client.get(`/api/assets/${asset.id}/raw`).headers({ cookie: cookies })
    raw.assertStatus(200)

    // Alias bez prefiksu /api — ścieżka sprawdzana przez Bramkę 2.
    const rawAlias = await client.get(`/assets/${asset.id}/raw`).headers({ cookie: cookies })
    rawAlias.assertStatus(200)

    const thumb = await client.get(`/api/assets/${asset.id}/thumb`).headers({ cookie: cookies })
    thumb.assertStatus(200)

    const other = await login(client)
    const forbidden = await client
      .get(`/api/assets/${asset.id}/raw`)
      .headers({ cookie: other.cookies })
    forbidden.assertStatus(404)

    const forbiddenAlias = await client
      .get(`/assets/${asset.id}/raw`)
      .headers({ cookie: other.cookies })
    forbiddenAlias.assertStatus(404)
  })

  test('PATCH notatka i DELETE asset', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const upload = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', await pngBuffer(2), { filename: 'note.png', contentType: 'image/png' })
    upload.assertStatus(201)
    const asset = upload.body().data[0]

    const patch = await client
      .patch(`/api/assets/${asset.id}`)
      .headers({ cookie: cookies })
      .json({ note: 'Moja notatka' })
    patch.assertStatus(200)
    assert.equal(patch.body().data.userNote, 'Moja notatka')

    const del = await client.delete(`/api/assets/${asset.id}`).headers({ cookie: cookies })
    del.assertStatus(204)

    const found = await Asset.find(asset.id)
    assert.isNull(found)
  })
})
