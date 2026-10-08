import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import { errors as vineErrors } from '@vinejs/vine'
import { sendPasswordChangedEmail } from '#services/account_mail'
import { absoluteUrl } from '#services/app_url'
import { t } from '#services/i18n'
import { changePasswordValidator, updateProfileValidator } from '#validators/user'
import ApiToken from '#models/api_token'
import { entitlementsFor } from '#services/billing/plans'
import { trackFor } from '#services/analytics/events'
import { revokeSessions } from '#services/sessions'
import { verificationRecord } from '#services/portal_domain'

function fieldError(field: string, message: string) {
  return new vineErrors.E_VALIDATION_ERROR([{ field, message, rule: field }])
}

export default class SettingsController {
  async show(ctx: HttpContext) {
    const { auth, inertia, session } = ctx
    const user = auth.user!
    const [tokens, { limits }] = await Promise.all([
      ApiToken.query().where('user_id', user.id).whereNull('revoked_at').orderBy('id', 'desc'),
      entitlementsFor(user.id),
    ])
    return inertia.render(
      'settings/index' as any,
      {
        account: {
          fullName: user.fullName,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
          createdAt: user.createdAt?.toISO() ?? null,
          marketingEmails: user.marketingEmails,
        },
        brand: {
          allowed: limits.whiteLabel,
          name: user.brandName,
          accent: user.brandAccent,
          logoUrl: user.brandLogoKey
            ? `/brand/${user.id}/logo?v=${encodeURIComponent(user.brandLogoKey.slice(-12))}`
            : null,
          portalDomain: user.portalDomain,
          portalDomainVerified: Boolean(user.portalDomainVerifiedAt),
          portalDomainRecord:
            user.portalDomain && user.portalDomainToken && !user.portalDomainVerifiedAt
              ? verificationRecord(user.portalDomain, user.portalDomainToken)
              : null,
          appHost: new URL(absoluteUrl(ctx, '/')).host,
        },
        api: {
          enabled: limits.api,
          endpoint: absoluteUrl(ctx, '/mcp'),
          restBase: absoluteUrl(ctx, '/api/v1'),
          newToken: (session.flashMessages.get('newApiToken') as string | undefined) ?? null,
          tokens: tokens.map((tk) => ({
            id: tk.id,
            name: tk.name,
            prefix: tk.prefix,
            createdAt: tk.createdAt?.toISO() ?? null,
            lastUsedAt: tk.lastUsedAt?.toISO() ?? null,
          })),
        },
      } as any
    )
  }

  async updateProfile({ auth, request, session, response }: HttpContext) {
    const { fullName } = await request.validateUsing(updateProfileValidator)
    const user = auth.user!
    user.fullName = fullName || null
    await user.save()
    session.flash('success', t('account.profileSaved'))
    return response.redirect().back()
  }

  async updatePassword(ctx: HttpContext) {
    const { auth, request, session, response } = ctx
    const { currentPassword, password } = await request.validateUsing(changePasswordValidator)
    const user = auth.user!

    if (!(await hash.verify(user.password, currentPassword))) {
      throw fieldError('currentPassword', t('account.currentPasswordWrong'))
    }
    if (currentPassword === password) {
      throw fieldError('password', t('account.samePassword'))
    }

    user.password = password
    await user.save()
    // Nowa sesja po zmianie hasła (ochrona przed przejęciem starego ID sesji)
    // i wylogowanie pozostałych urządzeń (SEC-14) — to zostaje zalogowane.
    session.regenerate()
    await revokeSessions(user, ctx)

    try {
      await sendPasswordChangedEmail(user, absoluteUrl(ctx, '/login'))
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'password changed email failed')
    }

    session.flash('success', t('account.passwordChanged'))
    return response.redirect().back()
  }

  /** POST /settings/sessions/revoke — wylogowanie ze wszystkich innych urządzeń (SEC-14). */
  async revokeSessions(ctx: HttpContext) {
    const { auth, session, response } = ctx
    await revokeSessions(auth.user!, ctx)
    trackFor(ctx, 'sessions_revoked', {})
    session.flash('success', t('account.sessionsRevoked'))
    return response.redirect().back()
  }
}
