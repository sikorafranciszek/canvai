import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserToken, { type UserTokenType } from '#models/user_token'

/**
 * Tokeny jednorazowe konta (weryfikacja e-mail, reset hasła).
 *
 * - Surowy token (32 losowe bajty, base64url) idzie tylko do maila; w bazie
 *   jest jego sha256 — wyciek bazy nie daje działających linków.
 * - Wydanie nowego tokenu unieważnia poprzednie tego samego typu.
 * - Token jest jednorazowy i ma termin ważności.
 */

export const TOKEN_TTL: Record<UserTokenType, { minutes: number }> = {
  email_verification: { minutes: 24 * 60 },
  password_reset: { minutes: 60 },
}

/** Minimalny odstęp między kolejnymi mailami tego samego typu (ochrona przed spamem). */
export const RESEND_COOLDOWN_SECONDS = 60

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function issueToken(user: User, type: UserTokenType): Promise<string> {
  await UserToken.query()
    .where('user_id', user.id)
    .where('type', type)
    .whereNull('used_at')
    .delete()
  const raw = randomBytes(32).toString('base64url')
  await UserToken.create({
    userId: user.id,
    type,
    tokenHash: hashToken(raw),
    expiresAt: DateTime.utc().plus(TOKEN_TTL[type]),
    usedAt: null,
  })
  return raw
}

/** Token nadal ważny (bez zużywania) — np. żeby pokazać formularz resetu. */
export async function findValidToken(raw: string, type: UserTokenType): Promise<UserToken | null> {
  if (!raw || raw.length > 200) return null
  const token = await UserToken.query()
    .where('token_hash', hashToken(raw))
    .where('type', type)
    .whereNull('used_at')
    .first()
  if (!token || token.expiresAt < DateTime.utc()) return null
  return token
}

/** Zużywa token i zwraca właściciela albo null (nieznany, zużyty, przeterminowany). */
export async function consumeToken(raw: string, type: UserTokenType): Promise<User | null> {
  const token = await findValidToken(raw, type)
  if (!token) return null
  token.usedAt = DateTime.utc()
  await token.save()
  // Pozostałe niewykorzystane tokeny tego typu przestają obowiązywać.
  await UserToken.query()
    .where('user_id', token.userId)
    .where('type', type)
    .whereNull('used_at')
    .delete()
  return User.find(token.userId)
}

/** Czy od ostatniego tokenu tego typu minęło mniej niż cooldown. */
export async function issuedRecently(user: User, type: UserTokenType): Promise<boolean> {
  const last = await UserToken.query()
    .where('user_id', user.id)
    .where('type', type)
    .orderBy('id', 'desc')
    .first()
  if (!last) return false
  return last.createdAt > DateTime.utc().minus({ seconds: RESEND_COOLDOWN_SECONDS })
}
