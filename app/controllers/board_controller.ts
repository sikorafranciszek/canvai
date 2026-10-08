import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Asset from '#models/asset'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import { createBoardValidator, updateBoardValidator } from '#validators/board'
import type { HttpContext } from '@adonisjs/core/http'
import { entitlementsFor } from '#services/billing/plans'
import { currentLocale, t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { BOARD_TEMPLATES, TEMPLATE_CAMERA, buildTemplateScene } from '#shared/board-templates'
import User from '#models/user'
import { boardAccess, memberBoardIds } from '#services/board_access'
import { deleteBoardFiles } from '#services/assets_service'

export default class BoardController {
  async index({ auth, inertia, session, response }: HttpContext) {
    const user = auth.user!
    // Zaproszenie przyjęte przed zalogowaniem / rejestracją — dokończ je teraz.
    const pendingInvite = session.get('pendingInvite') as string | undefined
    if (pendingInvite) return response.redirect().toPath(`/invites/${pendingInvite}`)

    const shared = await memberBoardIds(user.id)
    const boards = await Board.query()
      .where((q) => {
        q.where('user_id', user.id)
        if (shared.size) q.orWhereIn('id', [...shared.keys()])
      })
      .orderBy('updated_at', 'desc')
    const ids = boards.map((b) => b.id)
    const ownerIds = [...new Set(boards.map((b) => b.userId).filter((id) => id !== user.id))]
    const owners = ownerIds.length ? await User.query().whereIn('id', ownerIds) : []

    // Dane kart (ARC-2): agregaty SQL zamiast ładowania wszystkich materiałów,
    // wersji dokumentów (z treścią) i pełnych scen — tylko liczby i daty.
    const [counts, covers, docs, scenes] = ids.length
      ? await Promise.all([
          db
            .from('assets')
            .whereIn('board_id', ids)
            .groupBy('board_id')
            .select('board_id')
            .count('* as total'),
          db
            .from('assets')
            .whereIn('board_id', ids)
            .where('kind', 'image')
            .whereNotNull('thumb_key')
            .distinctOn('board_id')
            .orderBy([{ column: 'board_id' }, { column: 'id', order: 'asc' }])
            .select('board_id', 'id'),
          db
            .from('design_docs')
            .whereIn('board_id', ids)
            .distinctOn('board_id')
            .orderBy([{ column: 'board_id' }, { column: 'version', order: 'desc' }])
            .select('board_id', 'version', 'status', 'generated_at'),
          db.from('board_scenes').whereIn('board_id', ids).select('board_id', 'updated_at'),
        ])
      : [[], [], [], []]
    const byBoard = <T extends { board_id: number }>(rows: T[]) =>
      new Map(rows.map((r) => [Number(r.board_id), r]))
    const countOf = byBoard(counts as { board_id: number; total: string }[])
    const coverOf = byBoard(covers as { board_id: number; id: number }[])
    const docOf = byBoard(
      docs as { board_id: number; version: number; status: string; generated_at: Date | null }[]
    )
    const sceneOf = byBoard(scenes as { board_id: number; updated_at: Date | null }[])
    const fromDate = (d: Date | string | null | undefined) =>
      d ? DateTime.fromJSDate(new Date(d)).toUTC() : null

    const toIso = (value: DateTime | null | undefined) => value?.toISO() ?? null

    return inertia.render(
      'boards/index' as any,
      {
        boards: boards.map((b) => {
          const cover = coverOf.get(b.id)
          const doc = docOf.get(b.id)
          const sceneEdited = fromDate(sceneOf.get(b.id)?.updated_at)
          const edited = [b.updatedAt, sceneEdited, b.createdAt]
            .filter((d): d is DateTime => Boolean(d))
            .sort((x, y) => y.toMillis() - x.toMillis())[0]
          return {
            id: b.id,
            title: b.title,
            slug: b.slug,
            isSample: b.isSample,
            role: b.userId === user.id ? 'owner' : (shared.get(b.id) ?? 'viewer'),
            ownerName:
              b.userId === user.id
                ? null
                : (() => {
                    const o = owners.find((x) => x.id === b.userId)
                    return o?.fullName?.trim() || o?.email || null
                  })(),
            createdAt: toIso(b.createdAt),
            updatedAt: toIso(b.updatedAt),
            editedAt: toIso(edited),
            assetsCount: Number(countOf.get(b.id)?.total ?? 0),
            coverUrl: cover ? `/api/assets/${cover.id}/thumb` : null,
            designDoc: doc
              ? {
                  version: Number(doc.version),
                  status: doc.status,
                  generatedAt: toIso(fromDate(doc.generated_at)),
                }
              : null,
          }
        }),
      } as any
    )
  }

  /**
   * GET /api/board-limit — ile tablic zostało w planie (UX-5). Okno tworzenia
   * pokazuje limit od razu, zamiast przekierować do rozliczeń po wpisaniu tytułu.
   */
  async limit({ auth, response }: HttpContext) {
    const { limits } = await entitlementsFor(auth.user!.id)
    if (limits.boards == null)
      return response.json({ data: { limit: null, used: 0, reached: false } })
    const used = await this.ownBoardCount(auth.user!.id)
    return response.json({ data: { limit: limits.boards, used, reached: used >= limits.boards } })
  }

  /** Własne tablice liczone do limitu planu (przykładowa nie zajmuje miejsca). */
  private async ownBoardCount(userId: number): Promise<number> {
    const [{ $extras }] = await Board.query()
      .where('user_id', userId)
      .where('is_sample', false)
      .count('* as total')
    return Number($extras.total)
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('boards/create' as any, {} as any)
  }

  async store(ctx: HttpContext) {
    const { auth, request, response, session } = ctx
    const { title, template } = await request.validateUsing(createBoardValidator)
    const user = auth.user!

    const { limits } = await entitlementsFor(user.id)
    if (limits.boards != null) {
      if ((await this.ownBoardCount(user.id)) >= limits.boards) {
        session.flash('error', t('billing.boardLimit', { limit: limits.boards }))
        return response.redirect().toPath('/billing')
      }
    }

    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      Math.random().toString(36).substring(2, 8)

    const board = await Board.create({ title, slug, userId: user.id })
    if (template && BOARD_TEMPLATES.some((x) => x.id === template)) {
      await BoardScene.create({
        boardId: board.id,
        document: buildTemplateScene(template, currentLocale()) as unknown as Record<
          string,
          unknown
        >,
        appState: { camera: TEMPLATE_CAMERA },
        version: 1,
      })
    }
    trackFor(ctx, 'board_created', { template: template ?? null }, { boardId: board.id })

    response.redirect().toPath(`/boards/${board.id}`)
  }

  async show(ctx: HttpContext) {
    const { auth, inertia, params, response } = ctx
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.redirect().toPath('/boards')
    const { board } = access
    // Przed potwierdzeniem e-maila przykład tylko do oglądania (UX-5).
    const role = ctx.sampleOnly ? 'viewer' : access.role

    return inertia.render(
      'boards/show' as any,
      {
        board: {
          id: board.id,
          title: board.title,
          slug: board.slug,
          createdAt: board.createdAt?.toISO(),
          updatedAt: board.updatedAt?.toISO(),
          role,
          isSample: board.isSample,
        },
        emailUnverified: Boolean(ctx.sampleOnly),
      } as any
    )
  }

  async update({ auth, request, response, params }: HttpContext) {
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) {
      return response.redirect().toPath('/boards')
    }

    const { title } = await request.validateUsing(updateBoardValidator)
    board.title = title
    await board.save()

    return response.redirect().back()
  }

  async destroy(ctx: HttpContext) {
    const { auth, response, params } = ctx
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) {
      return response.redirect().toPath('/boards')
    }

    const assets = await Asset.query().where('board_id', board.id)
    await board.delete()
    // Pliki po usunięciu wierszy — usunięta tablica nie zostawia danych na dysku.
    await deleteBoardFiles(board.id, assets)
    trackFor(ctx, 'board_deleted', {}, { boardId: board.id })

    response.redirect().toPath('/boards')
  }
}
