import { type DateTime } from 'luxon'
import Asset from '#models/asset'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import DesignDoc from '#models/design_doc'
import { createBoardValidator, updateBoardValidator } from '#validators/board'
import type { HttpContext } from '@adonisjs/core/http'
import { entitlementsFor } from '#services/billing/plans'
import { currentLocale, t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { BOARD_TEMPLATES, TEMPLATE_CAMERA, buildTemplateScene } from '#shared/board-templates'
import User from '#models/user'
import { boardAccess, memberBoardIds } from '#services/board_access'

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

    // Dane kart: liczba assetów, okładka (pierwszy obraz z miniaturą),
    // ostatni DESIGN.md i czas ostatniej edycji sceny.
    const [assets, docs, scenes] = ids.length
      ? await Promise.all([
          Asset.query().whereIn('board_id', ids).orderBy('id', 'asc'),
          DesignDoc.query().whereIn('board_id', ids).orderBy('version', 'desc'),
          BoardScene.query().whereIn('board_id', ids),
        ])
      : [[], [], []]

    const toIso = (value: DateTime | null | undefined) => value?.toISO() ?? null

    return inertia.render(
      'boards/index' as any,
      {
        boards: boards.map((b) => {
          const boardAssets = assets.filter((a) => a.boardId === b.id)
          const cover = boardAssets.find((a) => a.kind === 'image' && a.thumbKey)
          const doc = docs.find((d) => d.boardId === b.id)
          const scene = scenes.find((sc) => sc.boardId === b.id)
          const edited = [b.updatedAt, scene?.updatedAt, b.createdAt]
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
            assetsCount: boardAssets.length,
            coverUrl: cover ? `/api/assets/${cover.id}/thumb` : null,
            designDoc: doc
              ? { version: doc.version, status: doc.status, generatedAt: toIso(doc.generatedAt) }
              : null,
          }
        }),
      } as any
    )
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
      // Przykładowa tablica nie zajmuje miejsca w limicie planu.
      const [{ $extras }] = await Board.query()
        .where('user_id', user.id)
        .where('is_sample', false)
        .count('* as total')
      if (Number($extras.total) >= limits.boards) {
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

  async show({ auth, inertia, params, response }: HttpContext) {
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.redirect().toPath('/boards')
    const { board, role } = access

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

    await board.delete()
    trackFor(ctx, 'board_deleted', {}, { boardId: board.id })

    response.redirect().toPath('/boards')
  }
}
