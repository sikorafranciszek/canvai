import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import User from '#models/user'
import { issueToken } from '#services/account_tokens'

/** SEC-14: sesje w ciasteczku unieważniane wersją sesji konta. */
test.group('Sesje (SEC-14)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => mail.restore())

  async function user() {
    return User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'password123',
    })
  }

  async function login(client: any, u: User, password = 'password123') {
    const res = await client.post('/login').json({ email: u.email, password }).redirects(0)
    return res.headers()['set-cookie'] as string[]
  }

  /** Ciasteczka po odpowiedzi: nowe nadpisują stare o tej samej nazwie. */
  function merge(cookies: string[], res: any): string[] {
    const jar = new Map<string, string>()
    for (const c of [...cookies, ...((res.headers()['set-cookie'] as string[]) ?? [])]) {
      jar.set(c.split('=')[0], c.split(';')[0])
    }
    return [...jar.values()]
  }

  /** Czy ciasteczko jest zalogowane (strona chroniona bez przekierowania na /login). */
  async function signedIn(client: any, cookies: string[]) {
    const res = await client.get('/settings').headers({ cookie: cookies }).redirects(0)
    return res.status() === 200
  }

  test('zmiana hasła wylogowuje inne urządzenia, bieżące zostaje', async ({ client, assert }) => {
    mail.fake()
    const u = await user()
    const laptop = await login(client, u)
    const phone = await login(client, u)
    assert.isTrue(await signedIn(client, laptop))
    assert.isTrue(await signedIn(client, phone))

    const res = await client
      .put('/settings/password')
      .headers({ cookie: phone })
      .json({
        currentPassword: 'password123',
        password: 'newpassword456',
        passwordConfirmation: 'newpassword456',
      })
      .redirects(0)
    res.assertStatus(302)
    const phoneAfter = merge(phone, res)
    assert.isFalse(await signedIn(client, laptop), 'stare urządzenie wylogowane')
    assert.isTrue(await signedIn(client, phoneAfter), 'bieżące urządzenie zostaje')
  })

  test('„wyloguj inne urządzenia” i reset hasła', async ({ client, assert }) => {
    mail.fake()
    const u = await user()
    const a = await login(client, u)
    const b = await login(client, u)
    const res = await client.post('/settings/sessions/revoke').headers({ cookie: b }).redirects(0)
    res.assertStatus(302)
    const bAfter = merge(b, res)
    assert.isFalse(await signedIn(client, a))
    assert.isTrue(await signedIn(client, bAfter))

    // Reset hasła z linku wylogowuje wszystko.
    const token = await issueToken(u, 'password_reset')
    ;(
      await client
        .post('/reset-password')
        .json({ token, password: 'resetpass789', passwordConfirmation: 'resetpass789' })
        .redirects(0)
    ).assertStatus(302)
    assert.isFalse(await signedIn(client, bAfter))
    assert.isTrue(await signedIn(client, await login(client, u, 'resetpass789')))
  })
})
