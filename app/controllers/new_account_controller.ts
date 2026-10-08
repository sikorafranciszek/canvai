import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { sendVerificationLink } from '#services/account_mail'
import { currentLocale, t } from '#services/i18n'
import { createSampleBoardSafely } from '#services/sample_board'
import { errors as vineErrors } from '@vinejs/vine'
import { referrals } from '#config/billing'
import { isDisposableEmail } from '#services/disposable_email'
import { attachReferrer, isReferralCode } from '#services/billing/referrals'
import { trackFor } from '#services/analytics/events'
import { hit, rateKey } from '#services/rate_limit'
import { loginWithVersion } from '#services/sessions'

export default class NewAccountController {
  async create({ inertia, request, response }: HttpContext) {
    // Link polecający: kod zapamiętany na 30 dni (użytkownik może wrócić później).
    const ref = request.qs().ref
    if (isReferralCode(ref))
      response.cookie(referrals.cookie, ref, { maxAge: '30d', sameSite: 'lax' })
    return inertia.render('auth/signup', {})
  }

  async store(ctx: HttpContext) {
    const { request, response, session } = ctx
    const { passwordConfirmation, ...payload } = await request.validateUsing(signupValidator)
    // SEC-4: masowe zakładanie kont (darmowe kredyty, nagrody za polecenia).
    const limit = await hit(rateKey('signup:ip', request.ip()), 5, 60 * 60_000)
    if (!limit.allowed) {
      session.flash(
        'error',
        t('auth.tooManyAttempts', { minutes: Math.ceil(limit.retryAfterSec / 60) })
      )
      return response.redirect().back()
    }
    if (isDisposableEmail(payload.email)) {
      throw new vineErrors.E_VALIDATION_ERROR([
        { field: 'email', message: t('account.disposableEmail'), rule: 'disposable' },
      ])
    }
    const user = await User.create({ ...payload, emailVerifiedAt: null })
    // Przykładowa tablica z gotowym DESIGN.md — od razu widać, co robi produkt.
    await createSampleBoardSafely(user, currentLocale())
    await attachReferrer(user, request.cookie(referrals.cookie))
    trackFor(ctx, 'signup', { referred: Boolean(user.referredById) }, { userId: user.id })
    response.clearCookie(referrals.cookie)
    await loginWithVersion(ctx, user)

    // Konto działa dopiero po potwierdzeniu adresu (middleware `verified`).
    // Ekran weryfikacji sam mówi, dokąd wysłaliśmy link — flash tylko przy błędzie wysyłki.
    const sent = await sendVerificationLink(ctx, user)
    if (!sent) session.flash('error', t('account.mailFailed'))
    response.redirect().toPath('/verify-email')
  }
}
