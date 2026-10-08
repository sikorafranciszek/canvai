import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { clear, hitAll, rateKey } from '#services/rate_limit'
import { loginWithVersion } from '#services/sessions'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', {})
  }

  async store(ctx: HttpContext) {
    const { request, response, session } = ctx
    const { email, password } = await request.validateUsing(loginValidator)
    // SEC-4: limit prób na konto (zgadywanie hasła) i na IP (credential stuffing).
    const emailKey = rateKey('login:email', email)
    const limit = await hitAll([
      { key: emailKey, max: 10, windowMs: 15 * 60_000 },
      { key: rateKey('login:ip', request.ip()), max: 50, windowMs: 15 * 60_000 },
    ])
    if (!limit.allowed) {
      session.flash(
        'error',
        t('auth.tooManyAttempts', { minutes: Math.ceil(limit.retryAfterSec / 60) })
      )
      return response.redirect().toPath('/login')
    }
    const user = await User.verifyCredentials(email, password)
    await clear(emailKey)
    if (user.disabledAt) {
      session.flash('error', t('account.disabled'))
      return response.redirect().toPath('/login')
    }

    await loginWithVersion(ctx, user)
    trackFor(ctx, 'login', {}, { userId: user.id })
    response.redirect().toPath('/')
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.redirect().toPath('/login')
  }
}
