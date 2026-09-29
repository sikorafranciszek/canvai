import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { sendVerificationLink } from '#services/account_mail'
import { t } from '#services/i18n'

export default class NewAccountController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/signup', {})
  }

  async store(ctx: HttpContext) {
    const { request, response, auth, session } = ctx
    const { passwordConfirmation, ...payload } = await request.validateUsing(signupValidator)
    const user = await User.create({ ...payload, emailVerifiedAt: null })
    await auth.use('web').login(user)

    // Konto działa dopiero po potwierdzeniu adresu (middleware `verified`).
    // Ekran weryfikacji sam mówi, dokąd wysłaliśmy link — flash tylko przy błędzie wysyłki.
    const sent = await sendVerificationLink(ctx, user)
    if (!sent) session.flash('error', t('account.mailFailed'))
    response.redirect().toPath('/verify-email')
  }
}
