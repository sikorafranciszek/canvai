import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import Asset from '#models/asset'
import Board from '#models/board'
import User from '#models/user'
import { grantCredits } from '#services/billing/credits'
import {
  runLifecycleEmails,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from '#services/lifecycle_mail'

let seq = 0
async function makeUser(extra: Partial<User> = {}) {
  return User.create({
    email: `life-${Date.now()}-${++seq}@test.com`,
    password: 'password123',
    emailVerifiedAt: DateTime.utc().minus({ days: 3 }),
    ...extra,
  })
}

test.group('Maile cykliczne', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => mail.restore())

  test('tablica bez DESIGN.md, brak tablicy, wygasające kredyty — każdy raz', async ({
    assert,
  }) => {
    const { messages } = mail.fake()
    const now = DateTime.utc()

    const idle = await makeUser()
    const waiting = await makeUser()
    const board = await Board.create({ title: 'Sklep', slug: `s-${seq}`, userId: waiting.id })
    await db
      .from('boards')
      .where('id', board.id)
      .update({ created_at: now.minus({ days: 2 }).toJSDate() })
    await Asset.create({
      boardId: board.id,
      kind: 'image',
      filename: 'a.png',
      mime: 'image/png',
      size: 1,
      sha256: `x${seq}`,
      storageKey: null,
      source: 'upload',
    } as any)
    await grantCredits(waiting.id, {
      amount: 40,
      source: 'pack',
      expiresAt: now.plus({ days: 3 }),
      externalId: `test-pack-${seq}`,
    } as any)
    const optedOut = await makeUser({ marketingEmails: false })

    const first = await runLifecycleEmails(now)
    assert.isAtLeast(first.boardWaiting, 1)
    assert.isAtLeast(first.noBoard, 1)
    assert.isAtLeast(first.creditsExpiring, 1)

    const to = (u: User) =>
      messages.sent((m) => JSON.stringify(m.nodeMailerMessage.to).includes(u.email))
    assert.lengthOf(to(idle), 1, 'no_board')
    assert.lengthOf(to(waiting), 2, 'board_waiting + credits_expiring')
    assert.lengthOf(to(optedOut), 0, 'wypisany nie dostaje maili')
    const first0 = to(waiting)[0].nodeMailerMessage
    assert.include(String(first0.html), '/unsubscribe/')
    assert.include(JSON.stringify(first0.headers), 'List-Unsubscribe=One-Click')

    // Drugi przebieg nic nie wysyła ponownie.
    await runLifecycleEmails(now.plus({ minutes: 61 }))
    assert.lengthOf(to(idle), 1)
    assert.lengthOf(to(waiting), 2)
  })

  test('wypis: podpisany token, GET i POST one-click; zły token odrzucony', async ({
    client,
    assert,
  }) => {
    const user = await makeUser()
    const token = unsubscribeToken(user.id)
    assert.equal(verifyUnsubscribeToken(token), user.id)
    assert.isNull(verifyUnsubscribeToken(`${user.id}.AAAAAAAAAAAAAAAAAAAAAA`))
    assert.isNull(verifyUnsubscribeToken(`${user.id + 1}.${token.split('.')[1]}`))

    ;(await client.get(`/unsubscribe/${token}`)).assertStatus(200)
    await user.refresh()
    assert.isFalse(user.marketingEmails)

    const other = await makeUser()
    ;(await client.post(`/unsubscribe/${unsubscribeToken(other.id)}`)).assertStatus(204)
    await other.refresh()
    assert.isFalse(other.marketingEmails)
    ;(await client.post(`/unsubscribe/1.zzzzzzzzzzzzzzzzzzzzzz`)).assertStatus(404)
  })
})
