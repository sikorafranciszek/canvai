import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Board from '#models/board'
import BoardScene from '#models/board_scene'

test.group('Scene API', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login(client: any) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `scene-test-${suffix}@test.com`,
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
      title: 'Scene',
      slug: `scene-${suffix}`,
      userId: user.id,
    })
  }

  test('GET scene tworzy pusty dokument dla nowej tablicy', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const res = await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: cookies })
    res.assertStatus(200)

    const data = res.body().data
    assert.equal(data.version, 1)
    assert.deepEqual(data.document, { elements: [], metadata: {} })
    assert.deepEqual(data.appState, {})

    const scene = await BoardScene.query().where('board_id', board.id).first()
    assert.isDefined(scene)
    assert.equal(scene!.version, 1)
  })

  test('PUT z blokadą optymistyczną: inkrementacja i 409 przy rozjeździe', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const document = {
      elements: [
        {
          id: 'e1',
          type: 'sticky',
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
          width: 100,
          height: 100,
          text: 'hej',
          fill: '#ffffff',
        },
      ],
      metadata: { name: 't1' },
    }

    const put1 = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: { zoom: 1 } })
    put1.assertStatus(200)
    assert.equal(put1.body().data.version, 2)

    // Stara wersja → konflikt.
    const conflict = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: {} })
    conflict.assertStatus(409)
    assert.equal(conflict.body().currentVersion, 2)

    // Bieżąca wersja → sukces.
    const put2 = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 2, document, appState: { zoom: 2 } })
    put2.assertStatus(200)
    assert.equal(put2.body().data.version, 3)
    assert.deepEqual(put2.body().data.appState, { zoom: 2 })
  })

  test('zapis bezstratny: nieznane typy elementów i puste stringi przechodzą', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const document = {
      elements: [
        {
          id: 'x1',
          type: 'przyszly-typ',
          customField: '',
          nested: { empty: '' },
          x: 1,
          y: 2,
          rotation: 0,
          opacity: 1,
        },
        {
          id: 'img1',
          type: 'image',
          assetId: '42',
          width: 10,
          height: 20,
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
        },
      ],
      metadata: { empty: '', future: true },
    }

    const put = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: { camera: { zoom: 2 } } })
    put.assertStatus(200)

    const saved = put.body().data.document
    assert.equal(saved.elements[0].customField, '')
    assert.equal(saved.elements[0].nested.empty, '')
    assert.equal(saved.metadata.empty, '')
    assert.equal(saved.elements[1].assetId, '42')
    assert.equal(saved.elements[1].type, 'image')
  })

  test('odrzuca element image z data URL', async ({ client }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const document = {
      elements: [
        {
          id: 'i1',
          type: 'image',
          assetId: 'data:image/png;base64,AAAA',
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
          width: 1,
          height: 1,
        },
      ],
      metadata: {},
    }

    const res = await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({ version: 1, document, appState: {} })
    res.assertStatus(422)
  })
})

/** DAT-1: prawdziwa współbieżność (bez globalnej transakcji); dane sprzątane po teście. */
test.group('Scene API — równoległe zapisy', () => {
  test('dwa równoległe PUT z tą samą wersją → jeden 200, reszta 409', async ({
    client,
    assert,
    cleanup,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `scene-race-${suffix}@test.com`,
      password: 'password123',
    })
    cleanup(async () => {
      await User.query().where('id', user.id).delete()
    })
    const board = await Board.create({ title: 'Race', slug: `race-${suffix}`, userId: user.id })
    const login = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const cookies = login.headers()['set-cookie']

    // Równoległe pierwsze otwarcie tablicy nie zakłada dwóch scen.
    await Promise.all(
      Array.from({ length: 4 }, () =>
        client.get(`/api/boards/${board.id}/scene`).headers({ cookie: cookies })
      )
    )
    assert.lengthOf(await BoardScene.query().where('board_id', board.id), 1)

    const put = (label: string) =>
      client
        .put(`/api/boards/${board.id}/scene`)
        .headers({ cookie: cookies })
        .json({ version: 1, document: { elements: [], metadata: { label } }, appState: {} })
    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(put))
    const statuses = results.map((r) => r.status()).sort()
    assert.deepEqual(statuses, [200, 409, 409, 409, 409])
    const scene = await BoardScene.findByOrFail('board_id', board.id)
    assert.equal(scene.version, 2)
    const winner = results.find((r) => r.status() === 200)!
    assert.deepEqual(scene.document, winner.body().data.document)
  }).timeout(30_000)
})
