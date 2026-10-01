import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { listBoards, readyDoc, tokensFor } from '#services/design/access'
import { EXPORT_FORMATS } from '#services/design/exports'

const docQuery = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
    format: vine.enum(EXPORT_FORMATS).optional(),
  })
)

/**
 * REST v1 (token Bearer): lista tablic, DESIGN.md i tokeny. Tylko odczyt —
 * do skryptów, CI i integracji. Ten sam zakres danych co serwer MCP.
 */
export default class ApiV1Controller {
  /** GET /api/v1/boards */
  async boards({ apiUser, response }: HttpContext) {
    return response.json({ data: await listBoards(apiUser!.id) })
  }

  /** GET /api/v1/boards/:id/design-md?version= */
  async designMd({ apiUser, params, request, response }: HttpContext) {
    const { version } = await docQuery.validate(request.qs())
    const { board, doc } = await readyDoc(apiUser!.id, Number(params.id), version)
    if (!board) return response.status(404).json({ error: 'Board not found' })
    if (!doc?.contentMd)
      return response.status(404).json({ error: 'No ready DESIGN.md for this board' })
    response.header('Content-Type', 'text/markdown; charset=utf-8')
    response.header('X-Design-Version', String(doc.version))
    return response.send(doc.contentMd)
  }

  /** GET /api/v1/boards/:id/tokens?format=css|tailwind|tokens|tailwind3|scss|figma|cursor|claude|agents|prompt&version= */
  async tokens({ apiUser, params, request, response }: HttpContext) {
    const { version, format = 'tokens' } = await docQuery.validate(request.qs())
    const { board, doc } = await readyDoc(apiUser!.id, Number(params.id), version)
    if (!board) return response.status(404).json({ error: 'Board not found' })
    const file = doc ? tokensFor(doc, format) : null
    if (!file) return response.status(404).json({ error: 'No tokens — generate DESIGN.md first' })
    response.header('Content-Type', `${file.type}; charset=utf-8`)
    return response.send(file.body)
  }
}
