import type { HttpContext } from '@adonisjs/core/http'
import drive from '@adonisjs/drive/services/main'
import vine from '@vinejs/vine'
import sharp from 'sharp'
import { ulid } from 'ulid'
import User from '#models/user'
import { entitlementsFor } from '#services/billing/plans'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const brandValidator = vine.compile(
  vine.object({
    brandName: vine.string().trim().maxLength(80).optional(),
    brandAccent: vine
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    portalDomain: vine
      .string()
      .trim()
      .toLowerCase()
      .maxLength(253)
      .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
      .optional(),
  })
)

/**
 * Marka agencji (white-label, plan Agency): nazwa, kolor, logo i własna domena
 * portalu klienta. Logo jest publiczne (portal klienta działa bez logowania).
 */
export default class BrandController {
  private async allowed(userId: number) {
    return (await entitlementsFor(userId)).limits.whiteLabel
  }

  /** PATCH /settings/brand */
  async update(ctx: HttpContext) {
    const { auth, request, session, response } = ctx
    const user = auth.user!
    if (!(await this.allowed(user.id))) {
      session.flash('error', t('brand.locked'))
      return response.redirect().back()
    }
    const input = await request.validateUsing(brandValidator)
    if (input.portalDomain && /(^|\.)canvai\.dev$/.test(input.portalDomain)) {
      session.flash('error', t('brand.domainInvalid'))
      return response.redirect().back()
    }
    if (input.portalDomain) {
      const taken = await User.query()
        .where('portal_domain', input.portalDomain)
        .whereNot('id', user.id)
        .first()
      if (taken) {
        session.flash('error', t('brand.domainTaken'))
        return response.redirect().back()
      }
    }
    user.brandName = input.brandName || null
    user.brandAccent = input.brandAccent || null
    user.portalDomain = input.portalDomain || null
    await user.save()
    trackFor(ctx, 'brand_updated', { domain: Boolean(user.portalDomain) })
    session.flash('success', t('brand.saved'))
    return response.redirect().back()
  }

  /** POST /settings/brand/logo — PNG/JPG/WebP/SVG→PNG, przeskalowane do 600 px. */
  async logo({ auth, request, session, response }: HttpContext) {
    const user = auth.user!
    if (!(await this.allowed(user.id))) {
      session.flash('error', t('brand.locked'))
      return response.redirect().back()
    }
    const file = request.file('logo', {
      size: '4mb',
      extnames: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
    })
    if (!file || !file.isValid || !file.tmpPath) {
      session.flash('error', t('brand.logoInvalid'))
      return response.redirect().back()
    }
    let png: Buffer
    try {
      png = await sharp(file.tmpPath, { density: 300 })
        .resize({ width: 600, height: 240, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    } catch {
      session.flash('error', t('brand.logoInvalid'))
      return response.redirect().back()
    }
    const key = `brands/${user.id}/${ulid()}.png`
    await drive.use().put(key, png, { contentType: 'image/png', contentLength: png.length })
    if (user.brandLogoKey)
      await drive
        .use()
        .delete(user.brandLogoKey)
        .catch(() => {})
    user.brandLogoKey = key
    await user.save()
    session.flash('success', t('brand.saved'))
    return response.redirect().back()
  }

  /** DELETE /settings/brand/logo */
  async removeLogo({ auth, session, response }: HttpContext) {
    const user = auth.user!
    if (user.brandLogoKey)
      await drive
        .use()
        .delete(user.brandLogoKey)
        .catch(() => {})
    user.brandLogoKey = null
    await user.save()
    session.flash('success', t('brand.saved'))
    return response.redirect().back()
  }

  /** GET /brand/:userId/logo — publiczne logo agencji (portal, PDF). */
  async show({ params, response }: HttpContext) {
    const user = await User.find(params.userId)
    if (!user?.brandLogoKey) return response.notFound()
    const stream = await drive.use().getStream(user.brandLogoKey)
    response.header('Content-Type', 'image/png')
    response.header('Cache-Control', 'public, max-age=3600')
    response.header('X-Content-Type-Options', 'nosniff')
    return response.stream(stream)
  }
}
