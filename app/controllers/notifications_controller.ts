import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import { verifyUnsubscribeToken } from '#services/lifecycle_mail'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const updateValidator = vine.compile(vine.object({ marketingEmails: vine.boolean() }))

/** Zgoda na maile cykliczne: wypis z linku w mailu i przełącznik w Ustawieniach. */
export default class NotificationsController {
  private async unsubscribeUser(token: string) {
    const id = verifyUnsubscribeToken(token)
    const user = id ? await User.find(id) : null
    if (!user) return null
    if (user.marketingEmails) {
      user.marketingEmails = false
      await user.save()
    }
    return user
  }

  /** GET /unsubscribe/:token — wypis i strona potwierdzenia. */
  async unsubscribe(ctx: HttpContext) {
    const user = await this.unsubscribeUser(String(ctx.params.token))
    if (user) trackFor(ctx, 'unsubscribed', {}, { userId: user.id })
    return ctx.inertia.render('email/unsubscribed' as any, { ok: Boolean(user) } as any)
  }

  /** POST /unsubscribe/:token — wypis jednym kliknięciem z klienta poczty. */
  async unsubscribeOneClick({ params, response }: HttpContext) {
    const user = await this.unsubscribeUser(String(params.token))
    return user ? response.noContent() : response.notFound()
  }

  /** PATCH /settings/notifications */
  async update({ auth, request, session, response }: HttpContext) {
    const { marketingEmails } = await request.validateUsing(updateValidator)
    auth.user!.marketingEmails = marketingEmails
    await auth.user!.save()
    session.flash('success', t('lifecycle.settingsSaved'))
    return response.redirect().back()
  }
}
