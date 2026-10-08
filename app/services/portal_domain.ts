import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { DateTime } from 'luxon'
import User from '#models/user'

/**
 * Weryfikacja własnej domeny portalu (SEC-10): rekord TXT
 * `_canvai.<domena>` = `canvai-verify=<token>`. Dopiero zweryfikowana domena
 * trafia do linków portalu; zgłoszenie bez weryfikacji nie blokuje innych.
 */
export const domainDeps = { resolveTxt: (name: string) => resolveTxt(name) }

export function verificationRecord(domain: string, token: string) {
  return { name: `_canvai.${domain}`, value: `canvai-verify=${token}` }
}

export function newDomainToken(): string {
  return randomBytes(16).toString('hex')
}

export type VerifyResult = 'verified' | 'missing' | 'taken'

export async function verifyPortalDomain(user: User): Promise<VerifyResult> {
  if (!user.portalDomain || !user.portalDomainToken) return 'missing'
  const { name, value } = verificationRecord(user.portalDomain, user.portalDomainToken)
  let records: string[][] = []
  try {
    records = await domainDeps.resolveTxt(name)
  } catch {
    return 'missing'
  }
  if (!records.some((chunks) => chunks.join('').trim() === value)) return 'missing'
  const taken = await User.query()
    .where('portal_domain', user.portalDomain)
    .whereNotNull('portal_domain_verified_at')
    .whereNot('id', user.id)
    .first()
  if (taken) return 'taken'
  user.portalDomainVerifiedAt = DateTime.utc()
  await user.save()
  // Domena należy do zweryfikowanego — cudze niezweryfikowane zgłoszenia znikają.
  await User.query()
    .where('portal_domain', user.portalDomain)
    .whereNot('id', user.id)
    .update({ portalDomain: null, portalDomainToken: null })
  return 'verified'
}
