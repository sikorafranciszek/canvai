import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { LOCALE_COOKIE, LOCALES } from '#shared/i18n'

const localeValidator = vine.create({ locale: vine.enum(LOCALES) })

/**
 * POST /locale — zapamiętuje wybór języka: cookie (dla wszystkich) i konto
 * (dla zalogowanych — wybór działa też na innych urządzeniach i w mailach).
 */
export default class LocaleController {
  async update({ request, response, auth }: HttpContext) {
    const { locale } = await request.validateUsing(localeValidator)

    response.plainCookie(LOCALE_COOKIE, locale, {
      encode: false,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: '1y',
    })

    const user = (await auth.check()) ? auth.user : null
    if (user && user.locale !== locale) {
      user.locale = locale
      await user.save()
    }
    return response.json({ data: { locale } })
  }
}
