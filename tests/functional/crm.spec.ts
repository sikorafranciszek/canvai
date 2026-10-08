import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { billing } from '#config/billing'
import { crm } from '#config/analytics'
import Board from '#models/board'
import CrmNote from '#models/crm_note'
import User from '#models/user'
import { balanceOf } from '#services/billing/credits'
import {
  memory,
  parseUserAgent,
  redactPath,
  resetMemory,
  visitorId,
} from '#services/analytics/collector'

/**
 * CRM (crm.<host>): dostęp tylko dla administratorów, routing po domenie,
 * akcje na kontach. Analityka w testach trafia do sinka `memory`.
 */

const HOST = crm.host
let seq = 0

async function makeUser(prefix = 'crm', extra: Partial<User> = {}) {
  const suffix = `${Date.now()}-${++seq}`
  return User.create({
    emailVerifiedAt: DateTime.utc(),
    email: `${prefix}-${suffix}@test.com`,
    password: 'password123',
    ...extra,
  })
}

/** Dane strony Inertia z HTML (`<script data-page="app" type="application/json">`). */
function pageData(html: string): { component: string; props: Record<string, any> } {
  const raw = html.match(
    /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/
  )?.[1]
  return JSON.parse(raw ?? '{}')
}

async function crmLogin(client: any, user: User) {
  const res = await client
    .post('/login')
    .header('host', HOST)
    .form({ email: user.email, password: 'password123' })
    .redirects(0)
  return { res, cookies: res.headers()['set-cookie'] }
}

test.group('CRM', (group) => {
  const saved = { admins: [...crm.adminEmails], enforced: billing.enforced }
  let admin: User

  group.each.setup(async () => {
    const cleanup = await testUtils.db().withGlobalTransaction()
    admin = await makeUser('admin')
    crm.adminEmails.splice(0, crm.adminEmails.length, admin.email)
    billing.enforced = true
    resetMemory()
    return cleanup
  })
  group.each.teardown(() => {
    crm.adminEmails.splice(0, crm.adminEmails.length, ...saved.admins)
    billing.enforced = saved.enforced
  })

  test('routing po domenie: CRM tylko pod swoim hostem, aplikacja poza nim', async ({ client }) => {
    ;(await client.get('/users').header('host', HOST).redirects(0)).assertStatus(302)
    ;(await client.get('/boards').header('host', HOST)).assertStatus(404)
    ;(await client.get('/analytics')).assertStatus(404)
  })

  test('logowanie: tylko administrator; zwykły użytkownik nie wejdzie', async ({
    client,
    assert,
  }) => {
    const regular = await makeUser('regular')
    const denied = await crmLogin(client, regular)
    assert.equal(denied.res.header('location'), '/login')
    const dash = await client
      .get('/')
      .header('host', HOST)
      .header('cookie', denied.cookies)
      .redirects(0)
    dash.assertStatus(302)

    const ok = await crmLogin(client, admin)
    assert.equal(ok.res.header('location'), '/')
    const page = await client.get('/').header('host', HOST).header('cookie', ok.cookies)
    page.assertStatus(200)
    assert.equal(pageData(page.text()).component, 'crm/dashboard')
    assert.equal(page.header('x-robots-tag'), 'noindex, nofollow')
  })

  test('lista i karta użytkownika z wyszukiwaniem', async ({ client, assert }) => {
    const target = await makeUser('szukany', { fullName: 'Ala Szukana' })
    const { cookies } = await crmLogin(client, admin)
    const list = await client.get('/users?q=szukany').header('host', HOST).header('cookie', cookies)
    list.assertStatus(200)
    const users = pageData(list.text()).props.users as { id: number; email: string }[]
    assert.deepEqual(
      users.map((u) => u.id),
      [target.id]
    )

    const card = await client
      .get(`/users/${target.id}`)
      .header('host', HOST)
      .header('cookie', cookies)
    card.assertStatus(200)
    const props = pageData(card.text()).props
    assert.equal(props.profile.email, target.email)
    assert.equal(props.user.email, admin.email, 'współdzielony `user` to administrator')
  })

  test('akcje: kredyty, tagi, notatka, blokada (wylogowuje i blokuje logowanie)', async ({
    client,
    assert,
  }) => {
    const target = await makeUser('target')
    const { cookies } = await crmLogin(client, admin)
    const at = (path: string) =>
      client.post(path).header('host', HOST).header('cookie', cookies).redirects(0)

    const before = await balanceOf(target.id)
    ;(
      await at(`/users/${target.id}/credits`).form({ amount: 25, note: 'rekompensata' })
    ).assertStatus(302)
    assert.equal(await balanceOf(target.id), before + 25)

    ;(
      await client
        .put(`/users/${target.id}/tags`)
        .header('host', HOST)
        .header('cookie', cookies)
        .json({ tags: ['Agencja', 'beta'] })
        .redirects(0)
    ).assertStatus(302)
    await target.refresh()
    assert.deepEqual(target.crmTags, ['agencja', 'beta'])

    ;(await at(`/users/${target.id}/notes`).form({ body: 'Pytał o plan Team' })).assertStatus(302)
    assert.equal(
      (await CrmNote.query().where('user_id', target.id).firstOrFail()).authorId,
      admin.id
    )

    // Blokada: zalogowany użytkownik traci dostęp, nowe logowanie się nie uda.
    const appLogin = await client
      .post('/login')
      .json({ email: target.email, password: 'password123' })
      .redirects(0)
    const appCookies = appLogin.headers()['set-cookie']
    ;(await at(`/users/${target.id}/disable`)).assertStatus(302)
    const blocked = await client.get('/api/billing').header('cookie', appCookies)
    blocked.assertStatus(403)
    const relogin = await client
      .post('/login')
      .json({ email: target.email, password: 'password123' })
      .redirects(0)
    assert.equal(relogin.header('location'), '/login')
    ;(await at(`/users/${target.id}/enable`)).assertStatus(302)
    await target.refresh()
    assert.isNull(target.disabledAt)

    // Audyt akcji administratora.
    const actions = memory.events
      .filter((e) => e.event === 'crm_action')
      .map((e) => JSON.parse(String(e.props)).action)
    assert.includeMembers(actions, ['grant_credits', 'tags', 'note_added', 'disable', 'enable'])
  })

  test('usunięcie konta wymaga wpisania e-maila; usuwa tablice (kaskada)', async ({
    client,
    assert,
  }) => {
    const target = await makeUser('delete')
    const board = await Board.create({
      title: 'Do usunięcia',
      slug: `del-${Date.now()}`,
      userId: target.id,
    })
    const { cookies } = await crmLogin(client, admin)
    const del = (confirmEmail: string) =>
      client
        .delete(`/users/${target.id}`)
        .header('host', HOST)
        .header('cookie', cookies)
        .form({ confirmEmail })
        .redirects(0)

    ;(await del('zly@adres.pl')).assertStatus(302)
    assert.isNotNull(await User.find(target.id))

    ;(await del(target.email)).assertStatus(302)
    assert.isNull(await User.find(target.id))
    assert.isNull(await Board.find(board.id), 'tablica usunięta kaskadowo')

    // Administrator nie usunie samego siebie.
    ;(
      await client
        .delete(`/users/${admin.id}`)
        .header('host', HOST)
        .header('cookie', cookies)
        .form({ confirmEmail: admin.email })
        .redirects(0)
    ).assertStatus(302)
    assert.isNotNull(await User.find(admin.id))
  })
})

test.group('Analityka — zbieranie', (group) => {
  group.each.setup(() => {
    resetMemory()
    return testUtils.db().withGlobalTransaction()
  })

  test('wyświetlenie strony i żądanie są zapisywane (bez cookies)', async ({ client, assert }) => {
    const res = await client
      .get('/login')
      .header('accept', 'text/html')
      .header('referer', 'https://www.google.com/search?q=canvai')
      .header('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')
    res.assertStatus(200)
    const view = memory.events.find((e) => e.event === 'page_view')
    assert.exists(view)
    assert.equal(view!.route, '/login')
    assert.equal(view!.referrer_host, 'www.google.com')
    assert.equal(view!.device, 'mobile')
    assert.match(String(view!.visitor_id), /^[0-9a-f]{16}$/)
    const req = memory.requests.find((r) => r.route === '/login')
    assert.exists(req)
    assert.equal(req!.status, 200)
    // Analityka nie ustawia własnych cookies.
    const cookies = ([] as string[])
      .concat(res.headers()['set-cookie'] ?? [])
      .map((c) => c.split('=')[0])
    assert.notIncludeMembers(cookies, ['cv_aid', 'visitor_id'])
  })

  test('SEC-5: tokeny z URL nie trafiają do analityki', async ({ client, assert }) => {
    const token = 'gySsdpln3uUC_UldQ90qxUZNc4KoT5rYuVYlEJ0CNug'
    await client.get(`/reset-password/${token}`).header('accept', 'text/html')
    await client.get(`/invites/${token}`).redirects(0)
    await client.get(`/unsubscribe/12.AbCdEfGhIjKlMnOpQrStUv`)
    const all = JSON.stringify([memory.requests, memory.events])
    assert.notInclude(all, token)
    assert.notInclude(all, 'AbCdEfGhIjKlMnOpQrStUv')
    assert.include(all, '/reset-password/[redacted]')
    assert.equal(redactPath('/boards/12/scene?x=1'), '/boards/12/scene')
  })

  test('zdarzenia produktowe z kontekstem użytkownika', async ({ client, assert }) => {
    const user = await makeUser('events')
    const login = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    await client
      .post('/boards')
      .header('cookie', login.headers()['set-cookie'])
      .form({ title: 'Analityka' })
      .redirects(0)
    const events = memory.events.filter((e) => Number(e.user_id) === user.id).map((e) => e.event)
    assert.includeMembers(events, ['login', 'board_created'])
  })

  test('visitor_id: stały w ciągu dnia, inny następnego dnia; parser UA', ({ assert }) => {
    const d1 = new Date('2026-09-30T10:00:00Z')
    const d2 = new Date('2026-10-01T10:00:00Z')
    assert.equal(
      visitorId('1.2.3.4', 'UA', d1),
      visitorId('1.2.3.4', 'UA', new Date('2026-09-30T23:59:00Z'))
    )
    assert.notEqual(visitorId('1.2.3.4', 'UA', d1), visitorId('1.2.3.4', 'UA', d2))
    assert.deepEqual(
      parseUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130.0 Safari/537.36'),
      {
        device: 'desktop',
        browser: 'Chrome',
        os: 'Windows',
      }
    )
    assert.equal(parseUserAgent('Googlebot/2.1').device, 'bot')
  })
})
