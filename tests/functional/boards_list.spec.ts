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
