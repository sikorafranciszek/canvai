import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'

test.group('Auth', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('can register a new user', async ({ client }) => {
    const response = await client.post('/signup').json({
      email: 'newuser@test.com',
      password: 'password123',
      passwordConfirmation: 'password123',
    })

    response.assertStatus(200)
  })

  test('can login with valid credentials', async ({ client }) => {
    await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: 'login@test.com',
      password: 'password123',
    })

    const response = await client.post('/login').json({
      email: 'login@test.com',
      password: 'password123',
    })

    response.assertStatus(200)
  })

  test('cannot login with invalid credentials', async ({ client, assert }) => {
    await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: 'bad@test.com',
      password: 'password123',
    })

    const response = await client
      .post('/login')
      .json({
        email: 'bad@test.com',
        password: 'wrongpassword',
      })
      .redirects(0)

    assert.notEqual(response.status(), 200)
  })

  test('SEC-13: e-mail małymi literami, długie hasło, nieliczbowe id → 404', async ({
    client,
    assert,
  }) => {
    const long = 'p'.repeat(100)
    const res = await client
      .post('/signup')
      .json({
        fullName: 'Mix',
        email: '  Mixed.Case@Test.COM ',
        password: long,
        passwordConfirmation: long,
      })
      .redirects(0)
    res.assertStatus(302)
    const user = await User.findByOrFail('email', 'mixed.case@test.com')
    user.emailVerifiedAt = DateTime.utc()
    await user.save()
    const login = await client
      .post('/login')
      .json({ email: 'MIXED.case@test.com', password: long })
      .redirects(0)
    assert.equal(login.header('location'), '/')
    const cookies = login.headers()['set-cookie']
    ;(await client.get('/api/assets/abc').headers({ cookie: cookies })).assertStatus(404)
    ;(await client.get('/api/boards/1abc/design-docs').headers({ cookie: cookies })).assertStatus(
      404
    )
  })

  test('can logout', async ({ client }) => {
    await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: 'logout@test.com',
      password: 'password123',
    })

    const loginResponse = await client.post('/login').json({
      email: 'logout@test.com',
      password: 'password123',
    })

    const cookies = loginResponse.headers()['set-cookie']
    const logoutResponse = await client.post('/logout').headers({ cookie: cookies })

    logoutResponse.assertStatus(200)
  })

  test('unauthenticated user is redirected from protected route', async ({ client }) => {
    const response = await client.get('/boards/1').redirects(0)
    response.assertStatus(302)
  })
})
