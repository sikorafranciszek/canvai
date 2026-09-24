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

    const user = await User.findBy('email', 'newuser@test.com')
    response.assert?.isDefined?.(user)
  })

  test('can login with valid credentials', async ({ client }) => {
    await User.create({ email: 'login@test.com', password: 'password123' })

    const response = await client.post('/login').json({
      email: 'login@test.com',
      password: 'password123',
    })

    response.assertStatus(200)
  })

  test('cannot login with invalid credentials', async ({ client }) => {
    await User.create({ email: 'bad@test.com', password: 'password123' })

    const response = await client.post('/login').json({
      email: 'bad@test.com',
      password: 'wrongpassword',
    })

    response.assertStatus(200)
  })

  test('can logout', async ({ client }) => {
    await User.create({ email: 'logout@test.com', password: 'password123' })

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
