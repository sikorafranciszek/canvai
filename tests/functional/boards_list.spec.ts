import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Board from '#models/board'
import Asset from '#models/asset'
import DesignDoc from '#models/design_doc'

/** Lista tablic (ARC-2): karty z agregatów SQL — liczba materiałów, okładka, ostatnia wersja. */
test.group('Lista tablic', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('karta: liczba materiałów, pierwsza miniatura, najnowszy DESIGN.md', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `list-${Date.now()}@test.com`,
      password: 'password123',
    })
    const login = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const cookies = login.headers()['set-cookie'] as unknown as string[]

    const board = await Board.create({
      title: 'Karta',
      slug: `karta-${Date.now()}`,
      userId: user.id,
    })
    const empty = await Board.create({
      title: 'Pusta',
      slug: `pusta-${Date.now()}`,
      userId: user.id,
    })
    const base = { boardId: board.id, source: 'upload' as const, size: 10, mime: 'image/png' }
    await Asset.create({ ...base, kind: 'file', filename: 'a.txt' })
    const first = await Asset.create({
      ...base,
      kind: 'image',
      filename: 'b.png',
      thumbKey: 't/b.webp',
    })
    await Asset.create({ ...base, kind: 'image', filename: 'c.png', thumbKey: 't/c.webp' })
    for (const version of [1, 2]) {
      await DesignDoc.create({
        boardId: board.id,
        version,
        status: 'ready',
        contentMd: `# v${version}`,
      })
    }

    const page = await client.get('/boards').headers({ 'cookie': cookies, 'x-inertia': 'true' })
    let props = page.body()?.props
    if (!props) {
      // Inna wersja zasobów → pełna strona; dane z atrybutu data-page.
      const html = page.text()
      const raw = html.match(/data-page="([^"]+)"/)?.[1] ?? '{}'
      props = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')).props
    }
    const card = props.boards.find((b: { id: number }) => b.id === board.id)
    assert.equal(card.assetsCount, 3)
    assert.equal(card.coverUrl, `/api/assets/${first.id}/thumb`)
    assert.equal(card.designDoc.version, 2)
    assert.equal(card.designDoc.status, 'ready')
    const blank = props.boards.find((b: { id: number }) => b.id === empty.id)
    assert.equal(blank.assetsCount, 0)
    assert.isNull(blank.coverUrl)
    assert.isNull(blank.designDoc)
  })
})

test.group('Pierwsze uruchomienie (UX-5)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function loginAs(client: any, verified: boolean) {
    const user = await User.create({
      emailVerifiedAt: verified ? DateTime.utc() : null,
      email: `first-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'password123',
    })
    const res = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    return { user, cookies: res.headers()['set-cookie'] as unknown as string[] }
  }

  /** Props strony Inertia z pełnego HTML (bez nagłówka wersji zasobów). */
  function pageProps(res: any) {
    const html = res.text() as string
    const script = html.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/)?.[1]
    if (script) return JSON.parse(script).props
    const raw = html.match(/data-page="([^"]+)"/)?.[1] ?? '{}'
    return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')).props
  }

  test('przed potwierdzeniem e-maila: tylko podgląd własnej tablicy przykładowej', async ({
    client,
    assert,
  }) => {
    const { user, cookies } = await loginAs(client, false)
    const sample = await Board.create({
      title: 'Przykład',
      slug: `sample-${Date.now()}`,
      userId: user.id,
      isSample: true,
    })
    const own = await Board.create({ title: 'Moja', slug: `own-${Date.now()}`, userId: user.id })

    const page = await client.get(`/boards/${sample.id}`).headers({ cookie: cookies }).redirects(0)
    page.assertStatus(200)
    const props = pageProps(page)
    assert.equal(props.board.role, 'viewer')
    assert.isTrue(props.emailUnverified)
    ;(await client.get(`/api/boards/${sample.id}/scene`).headers({ cookie: cookies })).assertStatus(
      200
    )

    // Zapis, inne tablice i lista — nadal za weryfikacją.
    ;(
      await client
        .put(`/api/boards/${sample.id}/scene`)
        .headers({ cookie: cookies })
        .json({ version: 0, document: { version: 1, elements: [] }, appState: null })
    ).assertStatus(403)
    const other = await client.get(`/boards/${own.id}`).headers({ cookie: cookies }).redirects(0)
    assert.equal(other.header('location'), '/verify-email')

    const notice = await client.get('/verify-email').headers({ cookie: cookies }).redirects(0)
    assert.equal(pageProps(notice).sampleBoardId, sample.id)
  })

  test('limit tablic znany przed wysłaniem formularza', async ({ client, assert }) => {
    const { billing } = await import('#config/billing')
    const saved = billing.enforced
    billing.enforced = true
    try {
      const { user, cookies } = await loginAs(client, true)
      const free = await client.get('/api/board-limit').headers({ cookie: cookies })
      assert.isFalse(free.body().data.reached)
      await Board.create({ title: 'Jedna', slug: `one-${Date.now()}`, userId: user.id })
      const full = await client.get('/api/board-limit').headers({ cookie: cookies })
      assert.isTrue(full.body().data.reached)
      assert.equal(full.body().data.limit, 1)
    } finally {
      billing.enforced = saved
    }
  })
})
