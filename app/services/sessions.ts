import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'

/**
 * Wersja sesji (SEC-14). Sesja pamięta wersję konta z chwili logowania; sesja
 * bez znacznika (sprzed tej zmiany) liczy się jako 0 — po pierwszym podbiciu
 * wersji (np. reset hasła) także stare, skradzione ciasteczka przestają działać.
 */
export const SESSION_VERSION_KEY = 'sv'

/** Logowanie z zapisem bieżącej wersji sesji. */
export async function loginWithVersion(ctx: HttpContext, user: User) {
  await ctx.auth.use('web').login(user)
  ctx.session.put(SESSION_VERSION_KEY, user.sessionVersion ?? 0)
}

/** Czy sesja żądania jest nadal ważna dla konta. */
export function sessionCurrent(ctx: HttpContext, user: User): boolean {
  return Number(ctx.session.get(SESSION_VERSION_KEY, 0)) === (user.sessionVersion ?? 0)
}

/**
 * Unieważnia wszystkie sesje konta. `keep` zostawia zalogowane bieżące
 * urządzenie (zmiana hasła w ustawieniach, „wyloguj z innych urządzeń”).
 */
export async function revokeSessions(user: User, keep?: HttpContext) {
  user.sessionVersion = (user.sessionVersion ?? 0) + 1
  await user.save()
  keep?.session.put(SESSION_VERSION_KEY, user.sessionVersion)
}
