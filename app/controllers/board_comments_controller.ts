import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import BoardComment from '#models/board_comment'
import User from '#models/user'
import { boardAccess } from '#services/board_access'
import { colorFor, publish } from '#services/board_events'
import { trackFor } from '#services/analytics/events'
import { hitAll } from '#services/rate_limit'
import { t } from '#services/i18n'

const createValidator = vine.compile(
  vine.object({
    body: vine.string().trim().minLength(1).maxLength(4000),
    x: vine.number().range([-1e7, 1e7]).optional(),
    y: vine.number().range([-1e7, 1e7]).optional(),
    parentId: vine.number().withoutDecimals().positive().optional(),
  })
)
const updateValidator = vine.compile(
  vine.object({
    body: vine.string().trim().minLength(1).maxLength(4000).optional(),
    resolved: vine.boolean().optional(),
  })
)

/**
 * Komentarze na tablicy: wątek przypięty do punktu na płótnie + odpowiedzi.
 * Komentować mogą wszyscy uczestnicy (także rola „podgląd”); edycja i
 * usunięcie — autor albo właściciel tablicy; rozwiązanie wątku — każdy edytor.
 */
export default class BoardCommentsController {
  private async serialize(comments: BoardComment[], viewerId: number, ownerId: number) {
    const ids = [...new Set(comments.map((c) => c.userId).filter((x): x is number => x != null))]
    const users = ids.length ? await User.query().whereIn('id', ids) : []
    return comments.map((c) => {
      const u = users.find((x) => x.id === c.userId)
      return {
        id: c.id,
        parentId: c.parentId,
        x: c.x,
        y: c.y,
        body: c.body,
        resolved: Boolean(c.resolvedAt),
        createdAt: c.createdAt.toISO(),
        updatedAt: c.updatedAt?.toISO() ?? null,
        author: u
          ? {
              id: u.id,
              name: u.fullName?.trim() || u.email.split('@')[0],
              initials: u.initials,
              color: colorFor(u.id),
            }
          : null,
        canEdit: c.userId === viewerId || ownerId === viewerId,
      }
    })
  }

  /** GET /api/boards/:id/comments */
  async index({ auth, params, response }: HttpContext) {
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.notFound()
    // Najnowsze 1000 (DAT-6), wyświetlane chronologicznie.
    const comments = (
      await BoardComment.query()
        .where('board_id', access.board.id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1000)
    ).reverse()
    return response.json({
      data: await this.serialize(comments, auth.user!.id, access.board.userId),
    })
  }

  /** POST /api/boards/:id/comments — nowy wątek (x/y) albo odpowiedź (parentId). */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.notFound()
    const input = await request.validateUsing(createValidator)
    // SEC-9: także rola podglądu może komentować — limit chroni przed zasypaniem tablicy.
    const limit = await hitAll([
      { key: `comment:min:${auth.user!.id}`, max: 30, windowMs: 60_000 },
      { key: `comment:day:${auth.user!.id}`, max: 500, windowMs: 24 * 3600_000 },
    ])
    if (!limit.allowed) {
      return response.status(429).json({
        message: t('comments.rateLimited', { seconds: limit.retryAfterSec }),
        code: 'E_RATE_LIMIT',
      })
    }
    let parentId: number | null = null
    if (input.parentId) {
      const parent = await BoardComment.query()
        .where('board_id', access.board.id)
        .where('id', input.parentId)
        .whereNull('parent_id')
        .first()
      if (!parent) return response.status(422).json({ message: 'Unknown thread' })
      parentId = parent.id
    } else if (input.x === undefined || input.y === undefined) {
      return response.status(422).json({ message: 'Position required' })
    }
    const comment = await BoardComment.create({
      boardId: access.board.id,
      userId: auth.user!.id,
      parentId,
      x: parentId ? null : input.x,
      y: parentId ? null : input.y,
      body: input.body,
      resolvedAt: null,
    })
    publish(access.board.id, 'comments', {}, request.header('x-client-id'), auth.user!.id)
    trackFor(ctx, 'comment_added', { reply: Boolean(parentId) }, { boardId: access.board.id })
    const [data] = await this.serialize([comment], auth.user!.id, access.board.userId)
    return response.status(201).json({ data })
  }

  private async find(userId: number, id: string | number) {
    const comment = await BoardComment.find(id)
    if (!comment) return null
    const access = await boardAccess(userId, comment.boardId, 'view')
    return access ? { comment, access } : null
  }

  /** PATCH /api/comments/:id — treść (autor/właściciel) albo rozwiązanie (edytor). */
  async update({ auth, params, request, response }: HttpContext) {
    const found = await this.find(auth.user!.id, params.id)
    if (!found) return response.notFound()
    const { comment, access } = found
    const input = await request.validateUsing(updateValidator)
    const isAuthor = comment.userId === auth.user!.id
    if (input.body !== undefined) {
      if (!isAuthor && access.role !== 'owner') return response.forbidden()
      comment.body = input.body
    }
    if (input.resolved !== undefined) {
      if (access.role === 'viewer' && !isAuthor) return response.forbidden()
      comment.resolvedAt = input.resolved ? DateTime.utc() : null
    }
    await comment.save()
    publish(comment.boardId, 'comments', {}, request.header('x-client-id'), auth.user!.id)
    const [data] = await this.serialize([comment], auth.user!.id, access.board.userId)
    return response.json({ data })
  }

  /** DELETE /api/comments/:id */
  async destroy({ auth, params, request, response }: HttpContext) {
    const found = await this.find(auth.user!.id, params.id)
    if (!found) return response.notFound()
    const { comment, access } = found
    if (comment.userId !== auth.user!.id && access.role !== 'owner') return response.forbidden()
    await comment.delete()
    publish(comment.boardId, 'comments', {}, request.header('x-client-id'), auth.user!.id)
    return response.noContent()
  }
}
