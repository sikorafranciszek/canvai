import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import hash from '@adonisjs/core/services/hash'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserToken from '#models/user_token'

/**
 * Konto: weryfikacja e-mail przy rejestracji, reset hasła, zmiana hasła
 * i profilu w ustawieniach. Maile przechwytuje `mail.fake()`.
 */
test.group('Account', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function setup() {
    const fake = mail.fake()
    return {
      messages: fake.messages,
      restore: () => mail.restore(),
    }
  }

  /** Wyciąga ścieżkę linku z tekstu ostatniego maila do adresu. */
  function linkFrom(
    messages: ReturnType<typeof setup>['messages'],
    to: string,
    pathPrefix: string
  ) {
    const sent = messages.sent((m) => JSON.stringify(m.nodeMailerMessage.to).includes(to))
    const text = String(sent.at(-1)?.nodeMailerMessage.text ?? '')
    const url = text.match(new RegExp(`https?://\\S+${pathPrefix}\\S+`))?.[0]
    return url ? new URL(url).pathname : null
  }

  function unique(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  }

  async function signup(client: any, email: string) {
    const res = await client
      .post('/signup')
      .json({
        fullName: 'Anna Nowak',
        email,
        password: 'password123',
        passwordConfirmation: 'password123',
      })
      .redirects(0)
    return { res, cookies: res.headers()['set-cookie'] }
  }

  test('rejestracja: konto niezweryfikowane, mail z linkiem, aplikacja i API zablokowane', async ({
    client,
    assert,
  }) => {
    const { messages, restore } = setup()
    try {
      const email = unique('signup')
      const { res, cookies } = await signup(client, email)
      res.assertStatus(302)
      assert.equal(res.header('location'), '/verify-email')

      const user = await User.findByOrFail('email', email)
      assert.isNull(user.emailVerifiedAt)
      messages.assertSentCount(1)
      const [message] = messages.sent()
      assert.include(String(message.nodeMailerMessage.subject), 'Potwierdź adres e-mail')

      const boards = await client.get('/boards').headers({ cookie: cookies }).redirects(0)
      assert.equal(boards.header('location'), '/verify-email')
      const api = await client.get('/api/boards/1/scene').headers({ cookie: cookies })
      api.assertStatus(403)
      assert.equal(api.body().code, 'E_EMAIL_NOT_VERIFIED')

      const path = linkFrom(messages, email, '/verify-email/')
      assert.isNotNull(path)
      const verify = await client.get(path!).headers({ cookie: cookies }).redirects(0)
      assert.equal(verify.header('location'), '/boards')
      await user.refresh()
      assert.isNotNull(user.emailVerifiedAt)
      ;(await client.get('/boards').headers({ cookie: cookies })).assertStatus(200)

      // Link jest jednorazowy.
      const again = await client.get(path!).redirects(0)
      assert.equal(again.header('location'), '/login')
      // W bazie tylko hash tokenu.
      const stored = await UserToken.query().where('user_id', user.id)
      assert.isFalse(stored.some((tk) => path!.includes(tk.tokenHash)))
    } finally {
      restore()
    }
  })

  test('weryfikacja: wygasły link odrzucony, ponowna wysyłka z limitem czasu', async ({
    client,
    assert,
  }) => {
    const { messages, restore } = setup()
    try {
      const email = unique('resend')
      const { cookies } = await signup(client, email)
      const user = await User.findByOrFail('email', email)
      const path = linkFrom(messages, email, '/verify-email/')!

      await UserToken.query()
        .where('user_id', user.id)
        .update({ expires_at: DateTime.utc().minus({ minutes: 1 }).toSQL() })
      const expired = await client.get(path).headers({ cookie: cookies }).redirects(0)
      assert.equal(expired.header('location'), '/verify-email')
      await user.refresh()
      assert.isNull(user.emailVerifiedAt)

      // Zaraz po rejestracji — cooldown, bez nowego maila.
      await client.post('/verify-email/resend').headers({ cookie: cookies }).redirects(0)
      messages.assertSentCount(1)

      // Po upływie cooldownu wysyłka działa.
      await UserToken.query()
        .where('user_id', user.id)
        .update({ created_at: DateTime.utc().minus({ minutes: 5 }).toSQL() })
      await client.post('/verify-email/resend').headers({ cookie: cookies }).redirects(0)
      messages.assertSentCount(2)
    } finally {
      restore()
    }
  })

  test('reset hasła: ta sama odpowiedź dla nieznanego adresu, link ustawia nowe hasło raz', async ({
    client,
    assert,
  }) => {
    const { messages, restore } = setup()
    try {
      const email = unique('reset')
      await User.create({ email, password: 'oldpassword1', emailVerifiedAt: DateTime.utc() })

      const unknown = await client
        .post('/forgot-password')
        .json({ email: unique('nobody') })
        .redirects(0)
      const known = await client.post('/forgot-password').json({ email }).redirects(0)
      assert.equal(unknown.status(), known.status())
      messages.assertSentCount(1)
      assert.include(String(messages.sent()[0].nodeMailerMessage.subject), 'Reset hasła')

      const path = linkFrom(messages, email, '/reset-password/')!
      const token = path.split('/').pop()!
      ;(await client.get(path)).assertStatus(200)

      const mismatch = await client
        .post('/reset-password')
        .json({ token, password: 'newpassword1', passwordConfirmation: 'other' })
        .redirects(0)
      assert.equal(mismatch.status(), 302)

      const ok = await client
        .post('/reset-password')
        .json({ token, password: 'newpassword1', passwordConfirmation: 'newpassword1' })
        .redirects(0)
      assert.equal(ok.header('location'), '/login')
      const user = await User.findByOrFail('email', email)
      assert.isTrue(await hash.verify(user.password, 'newpassword1'))
      // Powiadomienie o zmianie hasła.
      messages.assertSent((m) =>
        String(m.nodeMailerMessage.subject).includes('Hasło zostało zmienione')
      )

      const reuse = await client
        .post('/reset-password')
        .json({ token, password: 'another123', passwordConfirmation: 'another123' })
        .redirects(0)
      assert.equal(reuse.header('location'), '/forgot-password')
      await user.refresh()
      assert.isTrue(await hash.verify(user.password, 'newpassword1'))

      const login = await client
        .post('/login')
        .json({ email, password: 'newpassword1' })
        .redirects(0)
      assert.equal(login.header('location'), '/')
    } finally {
      restore()
    }
  })

  test('ustawienia: zmiana hasła wymaga obecnego hasła, profil się zapisuje', async ({
    client,
    assert,
  }) => {
    const { messages, restore } = setup()
    try {
      const email = unique('settings')
      await User.create({ email, password: 'password123', emailVerifiedAt: DateTime.utc() })
      const login = await client
        .post('/login')
        .json({ email, password: 'password123' })
        .redirects(0)
      const cookies = login.headers()['set-cookie']

      ;(await client.get('/settings').headers({ cookie: cookies })).assertStatus(200)

      const wrong = await client
        .put('/settings/password')
        .headers({ cookie: cookies })
        .json({
          currentPassword: 'nope1234',
          password: 'newpassword1',
          passwordConfirmation: 'newpassword1',
        })
        .redirects(0)
      assert.equal(wrong.status(), 302)
      let user = await User.findByOrFail('email', email)
      assert.isTrue(await hash.verify(user.password, 'password123'))
      messages.assertNoneSent()

      const changed = await client
        .put('/settings/password')
        .headers({ cookie: cookies })
        .json({
          currentPassword: 'password123',
          password: 'newpassword1',
          passwordConfirmation: 'newpassword1',
        })
        .redirects(0)
      // Po zmianie hasła sesja dostaje nowe ID (regenerate) — nowe cookie z odpowiedzi.
      const freshCookies = changed.headers()['set-cookie']
      assert.isDefined(freshCookies)
      user = await User.findByOrFail('email', email)
      assert.isTrue(await hash.verify(user.password, 'newpassword1'))
      messages.assertSentCount(1)

      await client
        .patch('/settings/profile')
        .headers({ cookie: freshCookies })
        .json({ fullName: '  Jan Kowalski ' })
        .redirects(0)
      await user.refresh()
      assert.equal(user.fullName, 'Jan Kowalski')
    } finally {
      restore()
    }
  })

  test('mail w języku żądania (EN)', async ({ client, assert }) => {
    const { messages, restore } = setup()
    try {
      const email = unique('en')
      await User.create({ email, password: 'password123', emailVerifiedAt: DateTime.utc() })
      await client
        .post('/forgot-password')
        .header('accept-language', 'en')
        .json({ email })
        .redirects(0)
      assert.equal(
        String(messages.sent()[0].nodeMailerMessage.subject),
        'Reset your password — canvai'
      )
      assert.include(String(messages.sent()[0].nodeMailerMessage.text), 'Set a new password')
    } finally {
      restore()
    }
  })

  test('język: POST /locale ustawia cookie i zapisuje wybór w koncie (ma pierwszeństwo)', async ({ client, assert }) => {
    const email = unique('locale')
    await User.create({ email, password: 'password123', emailVerifiedAt: DateTime.utc() })
    const login = await client.post('/login').json({ email, password: 'password123' }).redirects(0)
    const cookies = login.headers()['set-cookie']

    const res = await client
      .post('/locale')
      .headers({ cookie: cookies })
      .json({ locale: 'en' })
    res.assertStatus(200)
    assert.match(String(res.headers()['set-cookie']), /dc_locale=en/)
    const user = await User.findByOrFail('email', email)
    assert.equal(user.locale, 'en')

    // Preferencja konta wygrywa z przeglądarką po polsku (bez cookie dc_locale).
    const page = await client
      .get('/settings')
      .headers({ 'cookie': cookies, 'accept-language': 'pl-PL' })
    assert.include(page.text(), 'lang="en"')

    ;(
      await client
        .post('/locale')
        .headers({ cookie: cookies, accept: 'application/json' })
        .json({ locale: 'de' })
    ).assertStatus(422)
  })

  test('język: ?lang= z linku strony canvai.dev wygrywa i zapisuje cookie', async ({ client, assert }) => {
    const res = await client.get('/signup?lang=en').header('accept-language', 'pl-PL')
    assert.include(res.text(), 'lang="en"')
    assert.match(String(res.headers()['set-cookie']), /dc_locale=en/)
  })

  test('język: przeglądarka w innym języku niż polski dostaje angielski', async ({ client, assert }) => {
    const de = await client.get('/login').header('accept-language', 'de-DE,de;q=0.9')
    assert.include(de.text(), 'lang="en"')
    const pl = await client.get('/login').header('accept-language', 'pl-PL,pl;q=0.9,en;q=0.8')
    assert.include(pl.text(), 'lang="pl"')
  })
})
