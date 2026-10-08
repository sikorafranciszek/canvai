import type { HttpContext } from '@adonisjs/core/http'
import { hitAll, rateKey } from '#services/rate_limit'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import User from '#models/user'
import { consumeToken, findValidToken, issuedRecently, issueToken } from '#services/account_tokens'
import { sendPasswordChangedEmail, sendPasswordResetEmail } from '#services/account_mail'
import { absoluteUrl } from '#services/app_url'
import { currentLocale, runWithLocale, t } from '#services/i18n'
import { isLocale } from '#shared/i18n'
import { forgotPasswordValidator, resetPasswordValidator } from '#validators/user'

/**
 * Reset hasła: prośba (mail z linkiem) → formularz nowego hasła → zapis.
 * Odpowiedź na prośbę jest zawsze taka sama — nie zdradza, czy konto istnieje.
 */
export default class PasswordResetController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/forgot_password' as any, {} as any)
  }

  async store(ctx: HttpContext) {
    const { request, session, response } = ctx
    const { email } = await request.validateUsing(forgotPasswordValidator)
    // SEC-4: bez zasypywania skrzynek mailami resetu. Odpowiedź taka sama jak przy
    // sukcesie (nie zdradzamy, czy konto istnieje), tylko mail nie wychodzi.
    const limit = await hitAll([
      { key: rateKey('reset:email', email), max: 3, windowMs: 60 * 60_000 },
      { key: rateKey('reset:ip', ctx.request.ip()), max: 10, windowMs: 60 * 60_000 },
    ])
    if (!limit.allowed) {
      session.flash('success', t('account.resetSent'))
      return response.redirect().back()
    }
    const user = await User.findBy('email', email)

    if (user && !(await issuedRecently(user, 'password_reset'))) {
      const token = await issueToken(user, 'password_reset')
      try {
        // Mail w języku konta odbiorcy (jeśli wybrał), inaczej w języku żądania.
        await runWithLocale(isLocale(user.locale) ? user.locale : currentLocale(), () =>
          sendPasswordResetEmail(user, absoluteUrl(ctx, `/reset-password/${token}`))
        )
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'password reset email failed')
      }
    }

    session.flash('success', t('account.resetSent'))
    return response.redirect().back()
  }

  /** GET /reset-password/:token — formularz (albo informacja, że link wygasł). */
  async edit({ params, inertia }: HttpContext) {
    const token = String(params.token ?? '')
    const valid = Boolean(await findValidToken(token, 'password_reset'))
    return inertia.render('auth/reset_password' as any, { token, valid } as any)
  }

  async update(ctx: HttpContext) {
    const { request, session, response } = ctx
    const { token, password } = await request.validateUsing(resetPasswordValidator)
    const user = await consumeToken(token, 'password_reset')
    if (!user) {
      session.flash('error', t('account.resetInvalid'))
      return response.redirect().toPath('/forgot-password')
    }

    user.password = password
    // Kliknięcie linku z maila potwierdza też własność adresu.
    if (!user.emailVerifiedAt) user.emailVerifiedAt = DateTime.utc()
    await user.save()

    try {
      await runWithLocale(isLocale(user.locale) ? user.locale : currentLocale(), () =>
        sendPasswordChangedEmail(user, absoluteUrl(ctx, '/login'))
      )
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'password changed email failed')
    }

    session.flash('success', t('account.resetDone'))
    return response.redirect().toPath('/login')
  }
}
