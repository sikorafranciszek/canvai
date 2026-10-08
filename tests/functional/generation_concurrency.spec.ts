import { DateTime } from 'luxon'
import sharp from 'sharp'
import { test } from '@japa/runner'
import Board from '#models/board'
import CreditTransaction from '#models/credit_transaction'
import DesignDoc from '#models/design_doc'
import Job from '#models/job'
import User from '#models/user'
import { billing } from '#config/billing'
import { setProviderOverride } from '#services/ai/provider'
import { MockProvider } from '#services/ai/mock_provider'

/** DAT-2: prawdziwa współbieżność (bez globalnej transakcji); dane sprzątane po teście. */
test.group('Start generacji pod obciążeniem równoległym (DAT-2)', () => {
  test('5 równoległych „Generuj” → jedna wersja, jedna rezerwacja, jedno zadanie', async ({
    client,
    assert,
    cleanup,
  }) => {
    const enforced = billing.enforced
    setProviderOverride(new MockProvider())
    const user = await User.create({
      emailVerifiedAt: DateTime.utc(),
      email: `gen-race-${Date.now()}@test.com`,
      password: 'password123',
    })
    cleanup(async () => {
      billing.enforced = enforced
      setProviderOverride(null)
      const docs = await DesignDoc.query()
        .join('boards', 'boards.id', 'design_docs.board_id')
        .where('boards.user_id', user.id)
        .select('design_docs.job_id')
      const jobIds = docs.map((d) => d.jobId).filter(Boolean) as number[]
      if (jobIds.length) await Job.query().whereIn('id', jobIds).delete()
      await User.query().where('id', user.id).delete()
    })
    billing.enforced = true
    const board = await Board.create({ title: 'Race', slug: `gr-${Date.now()}`, userId: user.id })
    const login = await client
      .post('/login')
      .json({ email: user.email, password: 'password123' })
      .redirects(0)
    const cookies = login.headers()['set-cookie']
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()
    const up = await client
      .post(`/api/boards/${board.id}/assets`)
      .headers({ cookie: cookies })
      .file('files', png, { filename: 'a.png', contentType: 'image/png' })
    up.assertStatus(201)
    const scene = await client.get(`/api/boards/${board.id}/scene`).headers({ cookie: cookies })
    await client
      .put(`/api/boards/${board.id}/scene`)
      .headers({ cookie: cookies })
      .json({
        version: scene.body().data.version,
        document: {
          metadata: {},
          elements: [
            {
              id: 'i',
              type: 'image',
              assetId: String(up.body().data[0].id),
              x: 0,
              y: 0,
              width: 64,
              height: 64,
              rotation: 0,
              opacity: 1,
            },
          ],
        },
        appState: {},
      })

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.post(`/api/boards/${board.id}/design-doc`).headers({ cookie: cookies }).json({})
      )
    )
    const statuses = results.map((r) => r.status()).sort()
    assert.deepEqual(statuses, [202, 409, 409, 409, 409])
    const docs = await DesignDoc.query().where('board_id', board.id)
    assert.lengthOf(docs, 1)
    assert.equal(docs[0].version, 1)
    assert.isNotNull(docs[0].jobId)
    const reserves = await CreditTransaction.query()
      .where('design_doc_id', docs[0].id)
      .where('kind', 'reserve')
    assert.isAbove(reserves.length, 0)
    assert.equal(
      await CreditTransaction.query()
        .where('user_id', user.id)
        .where('kind', 'reserve')
        .count('* as n')
        .then((r) => Number(r[0].$extras.n)),
      reserves.length,
      'brak rezerwacji dla odrzuconych żądań'
    )
  }).timeout(60_000)
})
