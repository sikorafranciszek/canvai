import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import { errors as vineErrors } from '@vinejs/vine'
import { sendPasswordChangedEmail } from '#services/account_mail'
import { absoluteUrl } from '#services/app_url'
import { t } from '#services/i18n'
import { changePasswordValidator, updateProfileValidator } from '#validators/user'

function fieldError(field: string, message: string) {
  return new vineErrors.E_VALIDATION_ERROR([{ field, message, rule: field }])
}

export default class SettingsController {
  async show({ auth, inertia }: HttpContext) {
    const user = auth.user!
    return inertia.render(
      'settings/index' as any,
      {
        account: {
          fullName: user.fullName,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
          createdAt: user.createdAt?.toISO() ?? null,
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
    // Nowa sesja po zmianie hasła (ochrona przed przejęciem starego ID sesji).
    session.regenerate()

    try {
      await sendPasswordChangedEmail(user, absoluteUrl(ctx, '/login'))
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'password changed email failed')
    }

    session.flash('success', t('account.passwordChanged'))
    return response.redirect().back()
  }
}
