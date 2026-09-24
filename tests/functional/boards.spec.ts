import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Board from '#models/board'

test.group('Boards CRUD', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login(client: any) {
    const user = await User.create({
      email: `board-test-${Date.now()}@test.com`,
      password: 'password123',
    })
    const loginResp = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    return { user, cookies: loginResp.headers()['set-cookie'] }
  }

  test('can list boards (empty)', async ({ client }) => {
    const { cookies } = await login(client)
    const response = await client.get('/boards').headers({ cookie: cookies })
    response.assertStatus(200)
  })

  test('can create a board via HTTP', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const response = await client
      .post('/boards')
      .json({ title: 'My Design Board' })
      .headers({ cookie: cookies })
      .redirects(0)
    response.assertStatus(302)

    const boards = await Board.query().where('user_id', user.id)
    assert.lengthOf(boards, 1)
    assert.equal(boards[0].title, 'My Design Board')
  })

  test('can see a board directly', async ({ client }) => {
    const { user, cookies } = await login(client)
    const board = await Board.create({
      title: 'Test Board',
      slug: `test-board-${Date.now()}`,
      userId: user.id,
    })

    const response = await client.get(`/boards/${board.id}`).headers({ cookie: cookies })
    response.assertStatus(200)
  })

  test('can update a board title via HTTP', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await Board.create({
      title: 'Old Title',
      slug: `old-title-${Date.now()}`,
      userId: user.id,
    })

    const response = await client
      .patch(`/boards/${board.id}`)
      .json({ title: 'New Title' })
      .headers({ cookie: cookies })
      .redirects(0)
    response.assertStatus(302)

    await board.refresh()
    assert.equal(board.title, 'New Title')
  })

  test('can delete a board via HTTP', async ({ client, assert }) => {
    const { user, cookies } = await login(client)
    const board = await Board.create({
      title: 'To Delete',
      slug: `to-delete-${Date.now()}`,
      userId: user.id,
    })

    const response = await client
      .delete(`/boards/${board.id}`)
      .headers({ cookie: cookies })
      .redirects(0)
    response.assertStatus(302)

    const found = await Board.find(board.id)
    assert.isNull(found)
  })

  test('cannot access another user board', async ({ client }) => {
    const { cookies } = await login(client)

    const otherUser = await User.create({
      email: `other-${Date.now()}@test.com`,
      password: 'password123',
    })
    const otherBoard = await Board.create({
      title: 'Private',
      slug: `private-${Date.now()}`,
      userId: otherUser.id,
    })

    const response = await client
      .get(`/boards/${otherBoard.id}`)
      .headers({ cookie: cookies })
      .redirects(0)
    response.assertStatus(302)
  })

  test('title is required when creating a board', async ({ client, assert }) => {
    const { cookies } = await login(client)
    const response = await client.post('/boards').json({}).headers({ cookie: cookies }).redirects(0)
    response.assertStatus(302)

    const boards = await Board.all()
    assert.lengthOf(boards, 0)
  })
})
