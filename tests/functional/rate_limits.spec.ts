import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { hit } from '#services/rate_limit'

test.group('Limity prób (SEC-4)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => mail.restore())

  test('licznik: okno stałe, blokada po przekroczeniu', async ({ assert }) => {
    for (let i = 0; i < 3; i++) assert.isTrue((await hit('t:x', 3, 60_000)).allowed)
    const blocked = await hit('t:x', 3, 60_000)
    assert.isFalse(blocked.allowed)
    assert.isAbove(blocked.retryAfterSec, 0)
  })

  test('logowanie: po 10 błędnych próbach nawet poprawne hasło jest blokowane', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `rl-${Date.now()}@test.com`,
      password: 'password123',
    })
    for (let i = 0; i < 10; i++) {
      await client.post('/login').json({ email: user.email, password: 'wrong-pass' }).redirects(0)
    }
    const res = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    assert.equal(res.header('location'), '/login')
    const home = await client
      .get('/boards')
      .header('cookie', res.headers()['set-cookie'])
      .redirects(0)
    assert.equal(home.status(), 302, 'nie zalogowano')
  })

  test('reset hasła: najwyżej 3 maile na adres na godzinę, ta sama odpowiedź', async ({
    client,
    assert,
  }) => {
    const { messages } = mail.fake()
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `rr-${Date.now()}@test.com`,
      password: 'password123',
    })
    for (let i = 0; i < 6; i++) {
      // Odstęp między wysyłkami wymusza też issuedRecently (60 s) — pomijamy go, cofając czas tokenów.
      const res = await client.post('/forgot-password').json({ email: user.email }).redirects(0)
      assert.equal(res.status(), 302)
      await db
        .from('user_tokens')
        .where('user_id', user.id)
        .update({ created_at: DateTime.utc().minus({ hours: 2 }).toJSDate() })
    }
    assert.equal(messages.sent().length, 3)
  })

  test('rejestracja: 5 kont na godzinę z jednego IP', async ({ client, assert }) => {
    const statuses: (string | undefined)[] = []
    for (let i = 0; i < 6; i++) {
      const res = await client
        .post('/signup')
        .json({
          fullName: 'A',
          email: `su-${Date.now()}-${i}@test.com`,
          password: 'password123',
          passwordConfirmation: 'password123',
        })
        .redirects(0)
      statuses.push(res.header('location'))
    }
    assert.equal(statuses.filter((l) => l === '/verify-email').length, 5)
  })
})
