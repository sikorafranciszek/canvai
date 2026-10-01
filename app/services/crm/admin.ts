import { crm } from '#config/analytics'
import type User from '#models/user'

export type AdminDenial = 'not_listed' | 'unverified' | 'disabled' | 'no_admins'

/** Dlaczego konto NIE jest administratorem (null = jest). */
export function adminDenial(user: User): AdminDenial | null {
  if (!crm.adminEmails.length) return 'no_admins'
  if (!crm.adminEmails.includes(user.email.toLowerCase())) return 'not_listed'
  if (!user.emailVerifiedAt) return 'unverified'
  if (user.disabledAt) return 'disabled'
  return null
}

/** Administrator CRM: adres z `ADMIN_EMAILS`, potwierdzony e-mail, konto aktywne. */
export function isAdmin(user: User | null | undefined): boolean {
  return Boolean(
    user &&
    user.emailVerifiedAt &&
    !user.disabledAt &&
    crm.adminEmails.includes(user.email.toLowerCase())
  )
}
