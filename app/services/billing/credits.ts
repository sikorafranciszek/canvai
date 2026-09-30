import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Exception } from '@adonisjs/core/exceptions'
import { billing, freeCredits } from '#config/billing'
import CreditGrant, { type CreditGrantSource } from '#models/credit_grant'
import CreditTransaction from '#models/credit_transaction'
import { planFor } from '#services/billing/plans'
import { t } from '#services/i18n'

/**
 * Kredyty: pule z datą ważności + dziennik transakcji.
 *
 * - Zużycie zdejmuje najpierw pule wygasające najwcześniej (bez daty — na końcu).
 * - Generacja: `reserve` przy zleceniu → po sukcesie rezerwacja zostaje
 *   (to jest opłata), po błędzie `releaseAll` oddaje wszystko.
 * - Każda operacja zmieniająca saldo idzie w transakcji bazy.
 */

export class InsufficientCreditsError extends Exception {
  static status = 402
  static code = 'E_INSUFFICIENT_CREDITS'

  constructor(
    public readonly needed: number,
    public readonly balance: number
  ) {
    super(t('billing.insufficient', { needed, balance }), {
      status: 402,
      code: 'E_INSUFFICIENT_CREDITS',
    })
  }
}

export function sqlTime(dt: DateTime): string {
  return dt.toUTC().toFormat(db.connection().dialect.dateTimeFormat)
}

function activeGrants(userId: number, trx?: TransactionClientContract) {
  const now = sqlTime(DateTime.utc())
  return CreditGrant.query({ client: trx })
    .where('user_id', userId)
    .whereNull('revoked_at')
    .where('remaining', '>', 0)
    .where((q) => q.whereNull('expires_at').orWhere('expires_at', '>', now))
}

/** Saldo = suma pozostałych kredytów w ważnych pulach. */
export async function balanceOf(userId: number): Promise<number> {
  const grants = await activeGrants(userId)
  return grants.reduce((sum, g) => sum + g.remaining, 0)
}

/** Najbliższe wygaśnięcie (dla UI: „20 kredytów wygasa 1 lis”). */
export async function nextExpiry(
  userId: number
): Promise<{ amount: number; expiresAt: string } | null> {
  const grant = await activeGrants(userId)
    .whereNotNull('expires_at')
    .orderBy('expires_at', 'asc')
    .first()
  return grant?.expiresAt ? { amount: grant.remaining, expiresAt: grant.expiresAt.toISO()! } : null
}

export interface GrantInput {
  source: CreditGrantSource
  amount: number
  expiresAt: DateTime | null
  /** Klucz idempotencji (np. `ls-order:123`) — drugi raz nic nie nalicza. */
  externalId: string
  note?: string
}

/** Przyznaje pulę kredytów. Zwraca `null`, jeśli `externalId` już był użyty. */
export async function grantCredits(userId: number, input: GrantInput): Promise<CreditGrant | null> {
  const existing = await CreditGrant.findBy('external_id', input.externalId)
  if (existing) return null
  try {
    return await db.transaction(async (trx) => {
      const grant = await CreditGrant.create(
        {
          userId,
          source: input.source,
          amount: input.amount,
          remaining: input.amount,
          expiresAt: input.expiresAt?.toUTC() ?? null,
          externalId: input.externalId,
        },
        { client: trx }
      )
      await CreditTransaction.create(
        {
          userId,
          kind: 'grant',
          amount: input.amount,
          grantId: grant.id,
          note: input.note ?? input.source,
        },
        { client: trx }
      )
      return grant
    })
  } catch (error) {
    // Wyścig dwóch równoległych żądań o ten sam klucz — wygrywa pierwsze.
    if (await CreditGrant.findBy('external_id', input.externalId)) return null
    throw error
  }
}

/** Cofa niewykorzystaną część puli (zwrot płatności). */
export async function revokeGrant(externalId: string, note: string): Promise<boolean> {
  return db.transaction(async (trx) => {
    const grant = await CreditGrant.query({ client: trx }).where('external_id', externalId).first()
    if (!grant || grant.revokedAt) return false
    const taken = grant.remaining
    grant.remaining = 0
    grant.revokedAt = DateTime.utc()
    await grant.save()
    await CreditTransaction.create(
      { userId: grant.userId, kind: 'revoke', amount: -taken, grantId: grant.id, note },
      { client: trx }
    )
    return true
  })
}

function startOfNextMonth(): DateTime {
  return DateTime.utc().startOf('month').plus({ months: 1 })
}

/**
 * Darmowe kredyty naliczane leniwie przy odczycie salda: jednorazowe na start
 * i miesięczne odnowienie w planie Free (nie kumuluje się — wygasa z końcem miesiąca).
 */
export async function ensureAutomaticGrants(userId: number): Promise<void> {
  if (!billing.enforced) return
  await grantCredits(userId, {
    source: 'signup',
    amount: freeCredits.signup,
    expiresAt: DateTime.utc().plus({ months: 12 }),
    externalId: `signup:${userId}`,
  })
  if ((await planFor(userId)) === 'free') {
    await grantCredits(userId, {
      source: 'monthly_free',
      amount: freeCredits.monthly,
      expiresAt: startOfNextMonth(),
      externalId: `monthly:${userId}:${DateTime.utc().toFormat('yyyy-MM')}`,
    })
  }
}

/**
 * Rezerwuje `amount` kredytów na generację dokumentu. Brak środków →
 * `InsufficientCreditsError` (402) i nic nie zostaje zdjęte.
 */
export async function reserveCredits(
  userId: number,
  amount: number,
  designDocId: number
): Promise<void> {
  if (amount <= 0) return
  await db.transaction(async (trx) => {
    const grants = await activeGrants(userId, trx)
      .orderByRaw('expires_at is null asc')
      .orderBy('expires_at', 'asc')
      .orderBy('id', 'asc')
    const balance = grants.reduce((sum, g) => sum + g.remaining, 0)
    if (balance < amount) throw new InsufficientCreditsError(amount, balance)

    let left = amount
    for (const grant of grants) {
      if (left === 0) break
      const take = Math.min(grant.remaining, left)
      grant.remaining -= take
      left -= take
      grant.useTransaction(trx)
      await grant.save()
      await CreditTransaction.create(
        { userId, kind: 'reserve', amount: -take, grantId: grant.id, designDocId },
        { client: trx }
      )
    }
  })
}

/** Oddaje całą niewykorzystaną rezerwację dokumentu (generacja nieudana). */
export async function releaseAll(designDocId: number, note = 'generation failed'): Promise<number> {
  return db.transaction(async (trx) => {
    const rows = await CreditTransaction.query({ client: trx })
      .where('design_doc_id', designDocId)
      .whereIn('kind', ['reserve', 'release'])
    const outstanding = new Map<number, number>()
    for (const row of rows) {
      if (row.grantId == null) continue
      outstanding.set(row.grantId, (outstanding.get(row.grantId) ?? 0) - row.amount)
    }

    let released = 0
    for (const [grantId, amount] of outstanding) {
      if (amount <= 0) continue
      const grant = await CreditGrant.query({ client: trx }).where('id', grantId).first()
      if (!grant) continue
      if (!grant.revokedAt) {
        grant.remaining += amount
        await grant.save()
      }
      await CreditTransaction.create(
        { userId: grant.userId, kind: 'release', amount, grantId, designDocId, note },
        { client: trx }
      )
      released += amount
    }
    return released
  })
}

/** Ile kredytów jest zarezerwowanych/pobranych dla dokumentu. */
export async function chargedFor(designDocId: number): Promise<number> {
  const rows = await CreditTransaction.query()
    .where('design_doc_id', designDocId)
    .whereIn('kind', ['reserve', 'release'])
  return -rows.reduce((sum, r) => sum + r.amount, 0)
}
