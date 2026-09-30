import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import ApiToken from '#models/api_token'
import { MAX_TOKENS, createApiToken } from '#services/api_tokens'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const createValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(80),
  })
)

/** Tokeny API w ustawieniach: utworzenie (token pokazany raz) i odwołanie. */
export default class ApiTokensController {
  /** POST /settings/api-tokens */
  async store(ctx: HttpContext) {
    const { auth, request, session, response } = ctx
    const user = auth.user!
    const { name } = await request.validateUsing(createValidator)
    const [{ $extras }] = await ApiToken.query()
      .where('user_id', user.id)
      .whereNull('revoked_at')
      .count('* as total')
    if (Number($extras.total) >= MAX_TOKENS) {
      session.flash('error', t('api.tokenLimit', { max: MAX_TOKENS }))
      return response.redirect().back()
    }
    const { token } = await createApiToken(user, name)
    // Surowy token tylko raz — przez flash, nigdy nie trafia do bazy ani logów.
    session.flash('newApiToken', token)
    trackFor(ctx, 'api_token_created')
    session.flash('success', t('api.tokenCreated'))
    return response.redirect().toPath('/settings#api')
  }

  /** DELETE /settings/api-tokens/:id */
  async destroy({ auth, params, session, response }: HttpContext) {
    const token = await ApiToken.query()
      .where('id', params.id)
      .where('user_id', auth.user!.id)
      .whereNull('revoked_at')
      .first()
    if (token) {
      token.revokedAt = DateTime.utc()
      await token.save()
      session.flash('success', t('api.tokenRevoked'))
    }
    return response.redirect().toPath('/settings#api')
  }
}
