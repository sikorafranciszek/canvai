import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { referrals } from '#config/billing'
import CreditGrant from '#models/credit_grant'
import User from '#models/user'
import { grantCredits } from '#services/billing/credits'

/**
 * Polecenia: każdy użytkownik ma kod (`/signup?ref=KOD`). Nowe konto zapamiętuje
 * polecającego, a po potwierdzeniu e-maila obie strony dostają kredyty —
 * jednorazowo (klucze `referral:<id>:…`) i z limitem na polecającego.
 */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function newCode(): string {
  const bytes = randomBytes(8)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function isReferralCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{6,16}$/.test(value)
}

/** Kod polecający użytkownika (tworzony przy pierwszym użyciu). */
export async function referralCodeFor(user: User): Promise<string> {
  if (user.referralCode) return user.referralCode
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    if (await User.findBy('referral_code', code)) continue
    user.referralCode = code
    await user.save()
    return code
  }
  throw new Error('Could not allocate a referral code')
}

/** Zapisuje polecającego przy rejestracji (nie można polecić samego siebie). */
export async function attachReferrer(user: User, code: string | null | undefined): Promise<void> {
  if (!isReferralCode(code) || user.referredById) return
  const referrer = await User.findBy('referral_code', code)
  if (!referrer || referrer.id === user.id) return
  user.referredById = referrer.id
  await user.save()
}

/** Nagroda po potwierdzeniu e-maila poleconego. Zwraca `true`, gdy przyznano. */
export async function rewardReferral(user: User): Promise<boolean> {
  if (!user.referredById || !user.emailVerifiedAt) return false
  const earned = await CreditGrant.query()
    .where('user_id', user.referredById)
    .where('external_id', 'like', 'referral:%:referrer')
    .count('* as total')
  const expiresAt = DateTime.utc().plus({ months: referrals.validMonths })

  // Polecony dostaje bonus zawsze; polecający — do limitu.
  const referred = await grantCredits(user.id, {
    source: 'referral',
    amount: referrals.reward,
    expiresAt,
    externalId: `referral:${user.id}:referred`,
  })
  if (Number(earned[0].$extras.total) < referrals.maxPerReferrer) {
    await grantCredits(user.referredById, {
      source: 'referral',
      amount: referrals.reward,
      expiresAt,
      externalId: `referral:${user.id}:referrer`,
    })
  }
  return referred !== null
}

/** Statystyki do strony Rozliczeń. */
export async function referralStats(userId: number) {
  const [invited, rewards] = await Promise.all([
    User.query().where('referred_by_id', userId).count('* as total'),
    CreditGrant.query()
      .where('user_id', userId)
      .where('external_id', 'like', 'referral:%:referrer')
      .sum('amount as total'),
  ])
  return {
    invited: Number(invited[0].$extras.total),
    earned: Number(rewards[0].$extras.total ?? 0),
    reward: referrals.reward,
    max: referrals.maxPerReferrer,
  }
}
