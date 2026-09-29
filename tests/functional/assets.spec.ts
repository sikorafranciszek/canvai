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
    await rm(app.tmpPath('test-storage'), { recursive: true, force: true })
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

  /**
   * Hardening z Bramki 2 (BLA-217 pkt 3): MIME assetu spada na `Content-Type`
   * przysłany przez klienta, gdy magic number nic nie rozpozna. Plik z treścią
   * HTML podany jako `image/png` NIE może wylądować jako `kind: image`.
   */
  test('odrzuca HTML podany jako image/png (rozjazd MIME vs zawartość)', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const response = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', Buffer.from('<html><body><script>alert(1)</script></body></html>'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })

    response.assertStatus(422)
    // Uwaga: ciało odpowiedzi jest tu puste (`{}`) — komunikat z `Exception` nie
    // jest serializowany dla 422 z tego endpointu (to samo dotyczy istniejącego
    // testu `evil.html`). Osobne znalezisko; celowo NIE asercjonuję treści
    // komunikatu, żeby test nie twierdził, że użytkownik coś czytelnego widzi.

    // Nic nie zostało zapisane — ani wiersz, ani (tym bardziej) kind: image.
    const stored = await Asset.query().where('board_id', board.id)
    assert.lengthOf(stored, 0)
  })

  /**
   * Kontrapunkt do testu powyżej: gdy magic number ROZPOZNA plik, bodyparser
   * nadpisuje `Content-Type` klienta typem wykrytym z bajtów. Prawdziwy JPEG
   * nazwany `.png` i zadeklarowany jako `image/png` nie jest więc rozjazdem —
   * zapisuje się z MIME zgodnym z zawartością. To jest właściwy inwariant:
   * w bazie nigdy nie ma `mime`, który kłamie o bajtach.
   */
  test('JPEG zadeklarowany jako image/png zapisuje sie z MIME wykrytym z bajtow', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer()

    const response = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', jpeg, { filename: 'mislabeled.png', contentType: 'image/png' })

    response.assertStatus(201)
    const asset = response.body().data[0]
    assert.equal(asset.kind, 'image')
    // Deklaracja klienta (`image/png`) przegrywa z zawartością — i tak ma być.
    assert.equal(asset.mime, 'image/jpeg')
    assert.equal(asset.width, 32)
    assert.equal(asset.height, 32)
  })

  test('odrzuca HTML podany jako image/svg+xml', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const response = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', Buffer.from('<!doctype html><html><body>nie svg</body></html>'), {
        filename: 'fake.svg',
        contentType: 'image/svg+xml',
      })

    response.assertStatus(422)

    const stored = await Asset.query().where('board_id', board.id)
    assert.lengthOf(stored, 0)
  })

  /**
   * Prawdziwy SVG przechodzi, ale oryginał NIGDY nie jest serwowany inline:
   * `/raw` to attachment + CSP, a `/content` oddaje zrasteryzowaną miniaturę webp.
   * To jest test przykrywający ustalenie z Bramki 2 (pkt 8).
   */
  test('SVG ze skryptem: zapisany, ale nigdy nie serwowany inline', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await createBoard(user)

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
        '<script>alert(1)</script><rect width="64" height="64" fill="#f00"/></svg>'
    )

    const upload = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', svg, { filename: 'payload.svg', contentType: 'image/svg+xml' })
    upload.assertStatus(201)

    const asset = upload.body().data[0]
    assert.equal(asset.kind, 'image')
    assert.equal(asset.mime, 'image/svg+xml')

    // /raw — oryginał tylko jako pobranie, z CSP blokującym wykonanie.
    const raw = await client.get(`/api/assets/${asset.id}/raw`).headers({ cookie: cookies })
    raw.assertStatus(200)
    assert.include(raw.headers()['content-disposition'], 'attachment')
    assert.equal(raw.headers()['content-security-policy'], "default-src 'none'; sandbox")
    assert.equal(raw.headers()['x-content-type-options'], 'nosniff')

    // /content — ścieżka używana przez <img> na płótnie: zrasteryzowany webp,
    // nigdy `image/svg+xml`.
    const content = await client.get(`/api/assets/${asset.id}/content`).headers({ cookie: cookies })
    content.assertStatus(200)
    assert.equal(content.headers()['content-type'], 'image/webp')

    // Ciało jest binarne (webp), nie tekstem — `.text()` jest tu `undefined`,
    // więc sprawdzamy bajty: nagłówek kontenera RIFF/WEBP i brak `<script>`
    // z oryginalnego SVG. To dowód, że `<img>` dostaje rastra, nie dokumentu XML.
    const bytes = Buffer.from(content.body())
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF')
    assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP')
    assert.notInclude(bytes.toString('latin1'), '<script>')
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
