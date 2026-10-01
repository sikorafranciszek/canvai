import type { HttpContext } from '@adonisjs/core/http'
import { boardAccess } from '#services/board_access'
import vine from '@vinejs/vine'
import BrandKit from '#models/brand_kit'
import DesignDoc from '#models/design_doc'
import { entitlementsFor } from '#services/billing/plans'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const createValidator = vine.compile(
  vine.object({
    boardId: vine.number().withoutDecimals().positive(),
    version: vine.number().withoutDecimals().positive().optional(),
    name: vine.string().trim().minLength(1).maxLength(120).optional(),
  })
)

const renameValidator = vine.compile(
  vine.object({ name: vine.string().trim().minLength(1).maxLength(120) })
)

/** Limit brand kitów na konto. */
const MAX_KITS = 50

function serialize(kit: BrandKit) {
  return {
    id: kit.id,
    name: kit.name,
    colors: kit.colors,
    fonts: kit.fonts,
    rules: kit.rules,
    sourceBoardId: kit.sourceBoardId,
    sourceVersion: kit.sourceVersion,
    createdAt: kit.createdAt?.toISO() ?? null,
  }
}

/**
 * Brand kity: zapis kolorów, fontów i zasad z gotowego DESIGN.md i ponowne
 * użycie na innych tablicach (plany płatne).
 */
export default class BrandKitsController {
  private async guard(ctx: HttpContext) {
    const { limits } = await entitlementsFor(ctx.auth.user!.id)
    if (!limits.brandKits) {
      ctx.response.status(403).json({ message: t('brandKits.locked'), code: 'E_PLAN_FEATURE' })
      return false
    }
    return true
  }

  /** GET /brand-kits — strona z listą. */
  async page({ auth, inertia }: HttpContext) {
    const [kits, { limits }] = await Promise.all([
      BrandKit.query().where('user_id', auth.user!.id).orderBy('id', 'desc'),
      entitlementsFor(auth.user!.id),
    ])
    return inertia.render(
      'brand_kits/index' as any,
      {
        kits: kits.map(serialize),
        allowed: limits.brandKits,
      } as any
    )
  }

  /** GET /api/brand-kits */
  async index({ auth, response }: HttpContext) {
    const kits = await BrandKit.query().where('user_id', auth.user!.id).orderBy('id', 'desc')
    const { limits } = await entitlementsFor(auth.user!.id)
    return response.json({ data: kits.map(serialize), meta: { allowed: limits.brandKits } })
  }

  /** POST /api/brand-kits — z gotowej wersji DESIGN.md tablicy. */
  async store(ctx: HttpContext) {
    if (!(await this.guard(ctx))) return
    const { auth, request, response } = ctx
    const { boardId, version, name } = await request.validateUsing(createValidator)
    const board = (await boardAccess(auth.user!.id, boardId, 'view'))?.board
    if (!board) return response.notFound()
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc?.spec) {
      return response
        .status(409)
        .json({ message: t('billing.exportNeedsRegen'), code: 'E_NO_SPEC' })
    }
    const [{ $extras }] = await BrandKit.query().where('user_id', auth.user!.id).count('* as total')
    if (Number($extras.total) >= MAX_KITS) {
      return response
        .status(422)
        .json({ message: t('brandKits.limit', { max: MAX_KITS }), code: 'E_LIMIT' })
    }

    const spec = doc.spec
    const kit = await BrandKit.create({
      userId: auth.user!.id,
      name: name ?? spec.name ?? board.title,
      colors: spec.colors.slice(0, 16).map((c) => ({ name: c.name, hex: c.hex, role: c.role })),
      fonts: spec.typography.families.slice(0, 4).map((f) => ({ name: f.name, role: f.role })),
      rules: [...spec.dos.slice(0, 5), ...spec.donts.slice(0, 3).map((d) => `Don't: ${d}`)],
      sourceBoardId: board.id,
      sourceVersion: doc.version,
    })
    trackFor(ctx, 'brand_kit_created', { colors: kit.colors.length }, { boardId: board.id })
    return response.status(201).json({ data: serialize(kit) })
  }

  /** PATCH /api/brand-kits/:id */
  async update({ auth, params, request, response }: HttpContext) {
    const kit = await BrandKit.query()
      .where('id', params.id)
      .where('user_id', auth.user!.id)
      .first()
    if (!kit) return response.notFound()
    const { name } = await request.validateUsing(renameValidator)
    kit.name = name
    await kit.save()
    return response.json({ data: serialize(kit) })
  }

  /** DELETE /api/brand-kits/:id */
  async destroy({ auth, params, response }: HttpContext) {
    const kit = await BrandKit.query()
      .where('id', params.id)
      .where('user_id', auth.user!.id)
      .first()
    if (!kit) return response.notFound()
    await kit.delete()
    return response.status(204)
  }
}
