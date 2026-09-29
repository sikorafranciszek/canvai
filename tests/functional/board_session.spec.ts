import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import { rm } from 'node:fs/promises'
import sharp from 'sharp'
import User from '#models/user'
import Board from '#models/board'

/**
 * Test integracyjny ścieżki z BLA-9: upload assetu → element `image` w scenie
 * (assetId) → trwałość po odświeżeniu (GET) → notatka użytkownika.
 * Front wywołuje dokładnie te endpointy (session.ts / api.ts).
 */
test.group('Board session (scena + assety)', (group) => {
  group.each.setup(async () => {
    await rm(app.tmpPath('test-storage'), { recursive: true, force: true })
    return testUtils.db().withGlobalTransaction()
  })

  async function login(client: any) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({ emailVerifiedAt: DateTime.utc(),
      email: `session-test-${suffix}@test.com`,
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
      title: 'Session',
      slug: `session-${suffix}`,
      userId: user.id,
    })
  }

  function pngBuffer(): Promise<Buffer> {
    return sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: { r: 60, g: 120, b: 220, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
  }

  test('wklejony obraz → asset + element image → przeżywa odświeżenie (GET)', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    // 1. Upload (symulacja Ctrl+V: source=paste).
    const upload = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .field('source', 'paste')
      .file('files', await pngBuffer(), { filename: 'zrzut.png', contentType: 'image/png' })
    upload.assertStatus(201)
    const asset = upload.body().data[0]

    // 2. Element `image` w scenie — tylko assetId + geometria.
    const document = {
      elements: [
        {
          id: 'el-1',
          type: 'image',
          assetId: String(asset.id),
          x: 10,
          y: 20,
          rotation: 0,
          opacity: 1,
          width: asset.width,
          height: asset.height,
        },
      ],
      metadata: {},
    }

    const put = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: { camera: { x: 1, y: 2, scale: 1.5 } } })
    put.assertStatus(200)
    assert.equal(put.body().data.version, 2)

    // 3. Notatka użytkownika (PATCH) — wejście dla AI.
    const patch = await client
      .patch(`/api/assets/${asset.id}`)
      .headers({ cookie: cookies })
      .json({ note: 'To jest zrzut ekranu dashboardu' })
    patch.assertStatus(200)
    assert.equal(patch.body().data.userNote, 'To jest zrzut ekranu dashboardu')

    // 4. Odświeżenie (GET) — scena i asset wracają z serwera.
    const scene = await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: cookies })
    scene.assertStatus(200)
    assert.equal(scene.body().data.version, 2)
    assert.equal(scene.body().data.document.elements[0].assetId, String(asset.id))
    assert.deepEqual(scene.body().data.appState.camera, { x: 1, y: 2, scale: 1.5 })

    const assets = await client.get(`/api/boards/${board.id}/assets`).headers({ cookie: cookies })
    assets.assertStatus(200)
    assert.lengthOf(assets.body().data, 1)
    assert.equal(assets.body().data[0].userNote, 'To jest zrzut ekranu dashboardu')
    assert.match(assets.body().data[0].urls.thumb, /\/thumb$/)
  })

  test('usunięcie assetu nie zostawia elementu obrazu w scenie', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const upload = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', await pngBuffer(), { filename: 'a.png', contentType: 'image/png' })
    upload.assertStatus(201)
    const asset = upload.body().data[0]

    const document = {
      elements: [
        { id: 'el-1', type: 'image', assetId: String(asset.id), x: 0, y: 0, rotation: 0, opacity: 1, width: 10, height: 10 },
      ],
      metadata: {},
    }
    await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: {} })

    // DELETE asset (front usuwa też element sceny — tu weryfikujemy tylko API).
    const del = await client.delete(`/api/assets/${asset.id}`).headers({ cookie: cookies })
    del.assertStatus(204)

    const assets = await client.get(`/api/boards/${board.id}/assets`).headers({ cookie: cookies })
    assert.lengthOf(assets.body().data, 0)
  })
})
