import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import Asset from '#models/asset'
import Board from '#models/board'
import BoardShare from '#models/board_share'
import PortalFeedback from '#models/portal_feedback'
import { entitlementsFor } from '#services/billing/plans'
import { absoluteUrl } from '#services/app_url'
import { newShareToken } from '#services/portal'
import { serializeAsset } from '#services/assets_service'
import { t } from '#services/i18n'

const updateValidator = vine.compile(
  vine.object({
    enabled: vine.boolean(),
    allowUpload: vine.boolean().optional(),
    showDoc: vine.boolean().optional(),
  })
)

/** Właściciel: ustawienia portalu klienta tablicy i decyzje klienta. */
export default class BoardSharesController {
  private async findBoard(userId: number, id: string | number) {
    const board = await Board.find(id)
    return board && board.userId === userId ? board : null
  }

  private async payload(ctx: HttpContext, board: Board) {
    const { limits } = await entitlementsFor(ctx.auth.user!.id)
    const share = await BoardShare.findBy('board_id', board.id)
    const feedback = await PortalFeedback.query()
      .where('board_id', board.id)
      .orderBy('id', 'desc')
      .limit(20)
    const active = share && !share.revokedAt
    return {
      allowed: limits.portal,
      enabled: Boolean(active),
      url: active ? absoluteUrl(ctx, `/c/${share!.token}`) : null,
      allowUpload: share?.allowUpload ?? true,
      showDoc: share?.showDoc ?? true,
      feedback: feedback.map((f) => ({
        id: f.id,
        decision: f.decision,
        version: f.version,
        name: f.name,
        comment: f.comment,
        createdAt: f.createdAt?.toISO() ?? null,
      })),
    }
  }

  /** GET /api/boards/:id/share */
  async show(ctx: HttpContext) {
    const board = await this.findBoard(ctx.auth.user!.id, ctx.params.id)
    if (!board) return ctx.response.notFound()
    return ctx.response.json({ data: await this.payload(ctx, board) })
  }

  /** PUT /api/boards/:id/share — włącz/wyłącz portal i jego opcje. */
  async update(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    const { limits } = await entitlementsFor(auth.user!.id)
    const input = await request.validateUsing(updateValidator)
    if (input.enabled && !limits.portal) {
      return response.status(403).json({ message: t('portal.locked'), code: 'E_PLAN_FEATURE' })
    }

    let share = await BoardShare.findBy('board_id', board.id)
    if (!share) {
      if (!input.enabled) return response.json({ data: await this.payload(ctx, board) })
      share = await BoardShare.create({
        boardId: board.id,
        token: newShareToken(),
        allowUpload: true,
        showDoc: true,
      })
    }
    share.revokedAt = input.enabled ? null : (share.revokedAt ?? DateTime.utc())
    if (input.allowUpload !== undefined) share.allowUpload = input.allowUpload
    if (input.showDoc !== undefined) share.showDoc = input.showDoc
    await share.save()
    return response.json({ data: await this.payload(ctx, board) })
  }

  /** POST /api/boards/:id/share/rotate — nowy link (stary przestaje działać). */
  async rotate(ctx: HttpContext) {
    const board = await this.findBoard(ctx.auth.user!.id, ctx.params.id)
    if (!board) return ctx.response.notFound()
    const share = await BoardShare.findBy('board_id', board.id)
    if (share) {
      share.token = newShareToken()
      await share.save()
    }
    return ctx.response.json({ data: await this.payload(ctx, board) })
  }

  /** POST /api/assets/:id/accept — materiał od klienta trafił na płótno. */
  async accept({ auth, params, response }: HttpContext) {
    const asset = await Asset.find(params.id)
    const board = asset ? await this.findBoard(auth.user!.id, asset.boardId) : null
    if (!asset || !board) return response.notFound()
    asset.inbox = false
    await asset.save()
    return response.json({ data: serializeAsset(asset) })
  }
}
