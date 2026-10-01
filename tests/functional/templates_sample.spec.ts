import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import DesignDoc from '#models/design_doc'
import User from '#models/user'
import { billing } from '#config/billing'
import { buildBoardContext } from '#services/design/board_context'
import { buildTemplateScene, BOARD_TEMPLATES } from '#shared/board-templates'
import { createSampleBoard } from '#services/sample_board'

test.group('Szablony i przykładowa tablica', (group) => {
  const enforced = billing.enforced
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => {
    billing.enforced = enforced
  })

  test('szablon: ramki, etykiety i strzałki; wskazówki pomijane w kontekście AI', ({ assert }) => {
    for (const tpl of BOARD_TEMPLATES) {
      const doc = buildTemplateScene(tpl.id, 'pl')
      const types = doc.elements.map((e) => e.type)
      assert.include(types, 'rectangle')
      assert.include(types, 'arrow', tpl.id)
      const context = buildBoardContext(doc)
      assert.isFalse(
        context.items.some((it) => it.text?.includes('Wrzuć') || it.text?.includes('Zrzut')),
        'wskazówki nie trafiają do AI'
      )
      assert.isTrue(
        context.items.every((it) => it.label === true),
        'zostają tylko etykiety ramek'
      )
    }
  })

  test('tworzenie tablicy z szablonu zapisuje scenę', async ({ client, assert }) => {
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `tpl-${Date.now()}@test.com`,
      password: 'password123',
    })
    const login = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const res = await client
      .post('/boards')
      .header('cookie', login.headers()['set-cookie'])
      .form({ title: 'Panel', template: 'saas' })
      .redirects(0)
    res.assertStatus(302)
    const board = await Board.query()
      .where('user_id', user.id)
      .where('is_sample', false)
      .firstOrFail()
    const scene = await BoardScene.findByOrFail('board_id', board.id)
    assert.equal((scene.document as any).metadata.template, 'saas')
  })

  test('rejestracja tworzy przykładową tablicę z gotowym DESIGN.md (poza limitem planu)', async ({
    client,
    assert,
  }) => {
    billing.enforced = true
    const email = `sample-${Date.now()}@test.com`
    const res = await client
      .post('/signup')
      .form({
        fullName: 'Ola',
        email,
        password: 'password123!',
        passwordConfirmation: 'password123!',
      })
      .redirects(0)
    res.assertStatus(302)
    const user = await User.findByOrFail('email', email)
    const sample = await Board.query()
      .where('user_id', user.id)
      .where('is_sample', true)
      .firstOrFail()
    const doc = await DesignDoc.query().where('board_id', sample.id).firstOrFail()
    assert.equal(doc.status, 'ready')
    assert.equal(doc.creditsCharged, 0)
    assert.include(doc.contentMd!, '# Ziarno — Style Reference')
    assert.match(doc.contentMd!, new RegExp(`\\[A${(doc.sources ?? [])[0].assetId}\\]`))

    // Przykład nie blokuje utworzenia pierwszej własnej tablicy w planie Free.
    user.emailVerifiedAt = DateTime.utc()
    await user.save()
    const login = await client.post('/login').json({ email, password: 'password123!' }).redirects(0)
    const created = await client
      .post('/boards')
      .header('cookie', login.headers()['set-cookie'])
      .form({ title: 'Moja' })
      .redirects(0)
    assert.match(created.header('location') ?? '', /^\/boards\/\d+$/)

    // Idempotentnie: druga próba nie tworzy kolejnej kopii.
    await createSampleBoard(user, 'pl')
    const count = await Board.query()
      .where('user_id', user.id)
      .where('is_sample', true)
      .count('* as n')
    assert.equal(Number(count[0].$extras.n), 1)
  })
})
