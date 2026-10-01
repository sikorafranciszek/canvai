import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { boardAccess } from '#services/board_access'
import { colorFor, connect, moveCursor } from '#services/board_events'

const cursorValidator = vine.compile(
  vine.object({
    clientId: vine.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    x: vine.number().range([-1e7, 1e7]),
    y: vine.number().range([-1e7, 1e7]),
  })
)

/** Strumień zdarzeń tablicy (SSE) i kursory uczestników. */
export default class BoardEventsController {
  /** GET /api/boards/:id/events?clientId= */
  async stream({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const access = await boardAccess(user.id, params.id, 'view')
    if (!access) return response.notFound()

    const raw = String(request.qs().clientId ?? '')
    const clientId = /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : randomUUID()
    const name = user.fullName?.trim() || user.email.split('@')[0]
    const { stream, close } = connect(access.board.id, {
      clientId,
      userId: user.id,
      name,
      initials: user.initials,
      color: colorFor(user.id),
      role: access.role,
    })
    request.request.on('close', close)

    response.header('Content-Type', 'text/event-stream; charset=utf-8')
    response.header('Cache-Control', 'no-cache, no-transform')
    response.header('Connection', 'keep-alive')
    response.header('X-Accel-Buffering', 'no')
    response.stream(stream)
  }

  /** POST /api/boards/:id/cursor — pozycja kursora w układzie sceny. */
  async cursor({ auth, params, request, response }: HttpContext) {
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.notFound()
    const { clientId, x, y } = await request.validateUsing(cursorValidator)
    moveCursor(access.board.id, clientId, Math.round(x), Math.round(y))
    return response.noContent()
  }
}
