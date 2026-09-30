import { crm } from '#config/analytics'
import type User from '#models/user'

/** Administrator CRM: adres z `ADMIN_EMAILS`, potwierdzony e-mail, konto aktywne. */
export function isAdmin(user: User | null | undefined): boolean {
  return Boolean(
    user &&
    user.emailVerifiedAt &&
    !user.disabledAt &&
    crm.adminEmails.includes(user.email.toLowerCase())
  )
}
