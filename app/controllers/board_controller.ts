import Board from '#models/board'
import { createBoardValidator, updateBoardValidator } from '#validators/board'
import type { HttpContext } from '@adonisjs/core/http'

export default class BoardController {
  async index({ auth, inertia }: HttpContext) {
    const user = auth.user!
    const boards = await Board.query().where('user_id', user.id).orderBy('updated_at', 'desc')

    return inertia.render(
      'boards/index' as any,
      {
        boards: boards.map((b) => ({
          id: b.id,
          title: b.title,
          slug: b.slug,
          createdAt: b.createdAt?.toISO(),
          updatedAt: b.updatedAt?.toISO(),
        })),
      } as any
    )
  }

  async create({ inertia }: HttpContext) {
    return inertia.render('boards/create' as any, {} as any)
  }

  async store({ auth, request, response }: HttpContext) {
    const { title } = await request.validateUsing(createBoardValidator)
    const user = auth.user!

    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      Math.random().toString(36).substring(2, 8)

    const board = await Board.create({ title, slug, userId: user.id })

    response.redirect().toPath(`/boards/${board.id}`)
  }

  async show({ auth, inertia, params, response }: HttpContext) {
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) {
      return response.redirect().toPath('/boards')
    }

    return inertia.render(
      'boards/show' as any,
      {
        board: {
          id: board.id,
          title: board.title,
          slug: board.slug,
          createdAt: board.createdAt?.toISO(),
          updatedAt: board.updatedAt?.toISO(),
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

  async destroy({ auth, response, params }: HttpContext) {
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) {
      return response.redirect().toPath('/boards')
    }

    await board.delete()

    response.redirect().toPath('/boards')
  }
}
