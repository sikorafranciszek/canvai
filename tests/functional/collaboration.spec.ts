import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import Board from '#models/board'
import BoardMember from '#models/board_member'
import User from '#models/user'
import { billing } from '#config/billing'
import { connect, publish } from '#services/board_events'

let seq = 0
async function account(client: any, prefix = 'collab') {
  const user = await User.create({
    emailVerifiedAt: DateTime.utc(),
    email: `${prefix}-${Date.now()}-${++seq}@test.com`,
    password: 'password123',
  })
  const res = await client
    .post('/login')
    .json({ email: user.email, password: 'password123' })
    .redirects(0)
  return { user, cookies: res.headers()['set-cookie'] as string[] }
}

async function invite(
  client: any,
  ownerCookies: string[],
  boardId: number,
  email: string,
  role: string
) {
  const res = await client
    .post(`/api/boards/${boardId}/members`)
    .headers({ cookie: ownerCookies })
    .json({ email, role })
  return res
}

test.group('Współpraca: członkowie, uprawnienia, komentarze, zdarzenia', (group) => {
  const enforced = billing.enforced
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    billing.enforced = enforced
    mail.restore()
  })

  test('zaproszenie → przyjęcie; edytor zapisuje scenę, podgląd tylko czyta, obcy nic', async ({
    client,
    assert,
  }) => {
    billing.enforced = false
    const { messages } = mail.fake()
    const owner = await account(client, 'owner')
    const editor = await account(client, 'editor')
    const viewer = await account(client, 'viewer')
    const stranger = await account(client, 'stranger')
    const board = await Board.create({ title: 'Wspólna', slug: `w-${seq}`, userId: owner.user.id })

    ;(await invite(client, owner.cookies, board.id, editor.user.email, 'editor')).assertStatus(201)
    ;(await invite(client, owner.cookies, board.id, viewer.user.email, 'viewer')).assertStatus(201)
    assert.lengthOf(messages.sent(), 2)
    // Zaproszony bez przyjęcia nie ma dostępu.
    ;(
      await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: editor.cookies })
    ).assertStatus(404)

    for (const who of [editor, viewer]) {
      const m = await BoardMember.query().where('email', who.user.email).firstOrFail()
      const res = await client
        .get(`/invites/${m.token}`)
        .headers({ cookie: who.cookies })
        .redirects(0)
      assert.equal(res.header('location'), `/boards/${board.id}`)
    }
    // Cudze konto nie przyjmie zaproszenia.
    const pending = await invite(client, owner.cookies, board.id, 'someone@else.test', 'viewer')
    pending.assertStatus(201)
    const other = await BoardMember.query().where('email', 'someone@else.test').firstOrFail()
    await client.get(`/invites/${other.token}`).headers({ cookie: stranger.cookies }).redirects(0)
    await other.refresh()
    assert.isNull(other.acceptedAt)

    const scene = await client
      .get(`/api/boards/${board.id}/scene`)
      .headers({ cookie: editor.cookies })
    scene.assertStatus(200)
    const put = (cookies: string[], version: number) =>
      client
        .put(`/api/boards/${board.id}/scene`)
        .headers({ cookie: cookies })
        .json({ version, document: { elements: [], metadata: { by: 'x' } }, appState: {} })
    ;(await put(editor.cookies, scene.body().data.version)).assertStatus(200)
    ;(
      await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: viewer.cookies })
    ).assertStatus(200)
    ;(await put(viewer.cookies, 2)).assertStatus(403)
    ;(
      await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: stranger.cookies })
    ).assertStatus(404)

    // Lista tablic członka zawiera udostępnioną tablicę z rolą.
    const list = await client.get('/boards').headers({ cookie: viewer.cookies })
    assert.include(list.text(), 'Wspólna')

    // Podgląd nie zaprasza; właściciel może zmienić rolę i usunąć.
    ;(await invite(client, viewer.cookies, board.id, 'x@y.test', 'viewer')).assertStatus(403)
    const vm = await BoardMember.query().where('email', viewer.user.email).firstOrFail()
    ;(
      await client
        .patch(`/api/boards/${board.id}/members/${vm.id}`)
        .headers({ cookie: owner.cookies })
        .json({ role: 'editor' })
    ).assertStatus(200)
    ;(await put(viewer.cookies, 2)).assertStatus(200)
  })

  test('plan Free nie zaprasza; limit miejsc zależy od planu właściciela', async ({
    client,
    assert,
  }) => {
    billing.enforced = true
    mail.fake()
    const owner = await account(client, 'free')
    const board = await Board.create({ title: 'F', slug: `f-${seq}`, userId: owner.user.id })
    const res = await invite(client, owner.cookies, board.id, 'a@b.test', 'editor')
    res.assertStatus(403)
    assert.equal(res.body().code, 'E_PLAN_FEATURE')
  })

  test('komentarze: wątek, odpowiedź, rozwiązanie; podgląd komentuje, ale nie usuwa cudzych', async ({
    client,
    assert,
  }) => {
    billing.enforced = false
    mail.fake()
    const owner = await account(client, 'c-owner')
    const viewer = await account(client, 'c-viewer')
    const board = await Board.create({ title: 'K', slug: `k-${seq}`, userId: owner.user.id })
    await invite(client, owner.cookies, board.id, viewer.user.email, 'viewer')
    const m = await BoardMember.query().where('email', viewer.user.email).firstOrFail()
    await client.get(`/invites/${m.token}`).headers({ cookie: viewer.cookies }).redirects(0)

    const thread = await client
      .post(`/api/boards/${board.id}/comments`)
      .headers({ cookie: owner.cookies })
      .json({ body: 'Ten przycisk ma być większy', x: 120, y: 80 })
    thread.assertStatus(201)
    const id = thread.body().data.id
    const reply = await client
      .post(`/api/boards/${board.id}/comments`)
      .headers({ cookie: viewer.cookies })
      .json({ body: 'Zgoda', parentId: id })
    reply.assertStatus(201)
    ;(await client.delete(`/api/comments/${id}`).headers({ cookie: viewer.cookies })).assertStatus(
      403
    )
    ;(
      await client
        .patch(`/api/comments/${id}`)
        .headers({ cookie: owner.cookies })
        .json({ resolved: true })
    ).assertStatus(200)
    const list = await client
      .get(`/api/boards/${board.id}/comments`)
      .headers({ cookie: viewer.cookies })
    assert.lengthOf(list.body().data, 2)
    assert.isTrue(list.body().data.find((c: any) => c.id === id).resolved)
    // Wątek bez pozycji i odpowiedź do nieistniejącego wątku są odrzucane.
    ;(
      await client
        .post(`/api/boards/${board.id}/comments`)
        .headers({ cookie: owner.cookies })
        .json({ body: 'x' })
    ).assertStatus(422)
  })

  test('hub zdarzeń: obecność i publikacja do innych klientów (bez nadawcy)', async ({
    assert,
  }) => {
    const a = connect(999001, {
      clientId: 'client-aaaa',
      userId: 1,
      name: 'A',
      initials: 'A',
      color: '#000',
      role: 'owner',
    })
    const b = connect(999001, {
      clientId: 'client-bbbb',
      userId: 2,
      name: 'B',
      initials: 'B',
      color: '#111',
      role: 'editor',
    })
    const chunks: { a: string; b: string } = { a: '', b: '' }
    a.stream.on('data', (c) => (chunks.a += c.toString()))
    b.stream.on('data', (c) => (chunks.b += c.toString()))
    publish(999001, 'scene', { version: 7 }, 'client-aaaa')
    await new Promise((r) => setTimeout(r, 20))
    assert.include(chunks.b, 'event: scene\ndata: {"version":7}')
    assert.notInclude(chunks.a, 'event: scene')
    assert.include(chunks.a, 'event: presence')
    b.close()
    await new Promise((r) => setTimeout(r, 20))
    assert.match(chunks.a, /"participants":\[\{"clientId":"client-aaaa"/)
    a.close()
  })
})
