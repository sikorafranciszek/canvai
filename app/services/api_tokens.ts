import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import ApiToken from '#models/api_token'
import User from '#models/user'

/**
 * Tokeny API: `cvai_` + 40 znaków base62. W bazie tylko sha256 — wyciek bazy
 * nie ujawnia tokenów. Weryfikacja: hash → wiersz nieodwołany → użytkownik.
 */
const PREFIX = 'cvai_'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** Limit aktywnych tokenów na konto. */
export const MAX_TOKENS = 10

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createApiToken(user: User, name: string) {
  const random = Array.from(randomBytes(40), (b) => ALPHABET[b % ALPHABET.length]).join('')
  const token = `${PREFIX}${random}`
  const row = await ApiToken.create({
    userId: user.id,
    name: name.trim().slice(0, 80) || 'API',
    prefix: token.slice(0, 12),
    tokenHash: hash(token),
  })
  return { token, row }
}

export async function userForToken(token: string | null | undefined): Promise<User | null> {
  if (!token?.startsWith(PREFIX) || token.length < 20) return null
  const row = await ApiToken.query()
    .where('token_hash', hash(token))
    .whereNull('revoked_at')
    .first()
  if (!row) return null
  const user = await User.find(row.userId)
  if (!user?.emailVerifiedAt || user.disabledAt) return null
  // Znacznik użycia co najwyżej raz na minutę — bez zapisu przy każdym żądaniu.
  if (!row.lastUsedAt || row.lastUsedAt < DateTime.utc().minus({ minutes: 1 })) {
    row.lastUsedAt = DateTime.utc()
    await row.save()
  }
  return user
}

export function bearer(header: string | undefined | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : null
}
