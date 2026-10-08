import type { HttpContext } from '@adonisjs/core/http'
import drive from '@adonisjs/drive/services/main'
import vine from '@vinejs/vine'
import sharp from 'sharp'
import { ulid } from 'ulid'
import User from '#models/user'
import { entitlementsFor } from '#services/billing/plans'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { readFile } from 'node:fs/promises'
import { newDomainToken, verifyPortalDomain } from '#services/portal_domain'

/** SVG logo bez DTD/encji i bez odwołań poza dokument (tylko `#id` i `data:`). */
export function safeSvg(svg: string): boolean {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) return false
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    if (!/^(#|data:image\/(png|jpe?g|webp|gif);)/i.test(m[1].trim())) return false
  }
  return !/url\(\s*["']?(?!#|data:)/i.test(svg) && !/@import/i.test(svg)
}

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
      // Zajęta jest tylko domena zweryfikowana przez kogoś innego (SEC-10).
      const taken = await User.query()
        .where('portal_domain', input.portalDomain)
        .whereNotNull('portal_domain_verified_at')
        .whereNot('id', user.id)
        .first()
      if (taken) {
        session.flash('error', t('brand.domainTaken'))
        return response.redirect().back()
      }
    }
    user.brandName = input.brandName || null
    user.brandAccent = input.brandAccent || null
    const domain = input.portalDomain || null
    if (domain !== user.portalDomain) {
      user.portalDomain = domain
      user.portalDomainToken = domain ? newDomainToken() : null
      user.portalDomainVerifiedAt = null
    }
    await user.save()
    trackFor(ctx, 'brand_updated', { domain: Boolean(user.portalDomain) })
    session.flash('success', t('brand.saved'))
    return response.redirect().back()
  }

  /** POST /settings/brand/domain/verify — sprawdzenie rekordu TXT domeny portalu (SEC-10). */
  async verifyDomain(ctx: HttpContext) {
    const { auth, session, response } = ctx
    const user = auth.user!
    if (!(await this.allowed(user.id))) {
      session.flash('error', t('brand.locked'))
      return response.redirect().back()
    }
    const result = await verifyPortalDomain(user)
    trackFor(ctx, 'portal_domain_verify', { result })
    if (result === 'verified') session.flash('success', t('brand.domainVerified'))
    else
      session.flash('error', t(result === 'taken' ? 'brand.domainTaken' : 'brand.domainNotFound'))
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
      // SEC-16: render z bufora (bez ścieżki w katalogu tmp — librsvg nie rozwiąże
      // względnych odwołań), SVG bez DTD/encji i bez zewnętrznych zasobów.
      const input = await readFile(file.tmpPath)
      if (file.extname?.toLowerCase() === 'svg' && !safeSvg(input.toString('utf8'))) {
        throw new Error('unsafe svg')
      }
      png = await sharp(input, { density: 300 })
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
