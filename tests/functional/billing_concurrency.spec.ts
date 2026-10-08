import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CreditGrant from '#models/credit_grant'
import CreditTransaction from '#models/credit_transaction'
import User from '#models/user'
import { ops } from '#config/ops'
import { balanceOf, grantCredits, releaseAll, reserveCredits } from '#services/billing/credits'
import { claimGenerationSlot } from '#services/ops/ai_budget'

/**
 * SEC-3: prawdziwa współbieżność (bez globalnej transakcji testu — każde
 * wywołanie dostaje własne połączenie z puli). Dane sprzątane po teście.
 */
test.group('Kredyty i limity pod obciążeniem równoległym (SEC-3)', () => {
  test('10 równoległych rezerwacji przy saldzie na 2 → dokładnie 2 przechodzą', async ({
    assert,
    cleanup,
  }) => {
    const user = await User.create({
      email: `race-${Date.now()}@test.com`,
      password: 'password123',
    })
    cleanup(async () => {
      await User.query().where('id', user.id).delete()
    })
    await grantCredits(user.id, {
      source: 'pack',
      amount: 10,
      expiresAt: null,
      externalId: `race-pack-${user.id}`,
    })

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => reserveCredits(user.id, 4, { designDocId: 900000 + i }))
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2)
    assert.equal(await balanceOf(user.id), 2)
    const grant = await CreditGrant.findByOrFail('external_id', `race-pack-${user.id}`)
    assert.equal(grant.remaining, 2)

    // Równoległe zwroty tej samej rezerwacji — oddane dokładnie raz.
    const ok = results.findIndex((r) => r.status === 'fulfilled')
    const ref = { designDocId: 900000 + ok }
    const released = await Promise.all([releaseAll(ref), releaseAll(ref), releaseAll(ref)])
    assert.equal(
      released.reduce((a, b) => a + b, 0),
      4
    )
    assert.equal(await balanceOf(user.id), 6)
    const rows = await CreditTransaction.query().where('design_doc_id', ref.designDocId)
    assert.equal(rows.filter((r) => r.kind === 'release').length, 1)
  }).timeout(30_000)

  test('limit dziennych generacji nie daje się przekroczyć równoległymi żądaniami', async ({
    assert,
    cleanup,
  }) => {
    const saved = { ...ops.aiBudget }
    const user = await User.create({
      email: `slots-${Date.now()}@test.com`,
      password: 'password123',
    })
    cleanup(async () => {
      Object.assign(ops.aiBudget, saved)
      await User.query().where('id', user.id).delete()
    })
    Object.assign(ops.aiBudget, { userDailyGenerations: 3 })
    const results = await Promise.all(
      Array.from({ length: 12 }, () => claimGenerationSlot(user.id))
    )
    assert.equal(results.filter((r) => r === null).length, 3)
    const [row] = await db.from('ai_usage_daily').where('user_id', user.id)
    assert.equal(Number(row.generations), 3)
  }).timeout(30_000)
})
