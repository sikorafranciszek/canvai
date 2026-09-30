import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { consumeToken, issuedRecently } from '#services/account_tokens'
import { sendVerificationLink } from '#services/account_mail'
import { t } from '#services/i18n'
import { rewardReferral } from '#services/billing/referrals'

export default class EmailVerificationController {
  /** GET /verify-email — ekran „sprawdź skrzynkę” (dla zalogowanego, niezweryfikowanego). */
  async notice({ auth, inertia, response }: HttpContext) {
    const user = auth.user!
    if (user.emailVerifiedAt) return response.redirect().toPath('/boards')
    return inertia.render('auth/verify_email' as any, { email: user.email } as any)
  }

  /** POST /verify-email/resend — ponowna wysyłka z ograniczeniem częstotliwości. */
  async resend(ctx: HttpContext) {
    const { auth, session, response } = ctx
    const user = auth.user!
    if (user.emailVerifiedAt) {
      session.flash('success', t('account.alreadyVerified'))
      return response.redirect().toPath('/boards')
    }
    if (await issuedRecently(user, 'email_verification')) {
      session.flash('error', t('account.verifyCooldown'))
      return response.redirect().back()
    }
    const sent = await sendVerificationLink(ctx, user)
    session.flash(
      sent ? 'success' : 'error',
      sent ? t('account.verifySent', { email: user.email }) : t('account.mailFailed')
    )
    return response.redirect().back()
  }

  /** GET /verify-email/:token — link z maila; działa też bez zalogowania. */
  async verify({ params, auth, session, response }: HttpContext) {
    const user = await consumeToken(String(params.token ?? ''), 'email_verification')
    if (!user) {
      session.flash('error', t('account.verifyInvalid'))
      return response.redirect().toPath((await auth.check()) ? '/verify-email' : '/login')
    }
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = DateTime.utc()
      await user.save()
      // Polecenie nagradzamy dopiero za potwierdzony adres.
      await rewardReferral(user)
    }
    session.flash('success', t('account.verified'))
    const loggedInAsOwner = (await auth.check()) && auth.user?.id === user.id
    return response.redirect().toPath(loggedInAsOwner ? '/boards' : '/login')
  }
}
