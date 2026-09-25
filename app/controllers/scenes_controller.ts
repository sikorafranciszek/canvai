import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import { emptySceneDocument } from '#shared/scene'
import { validateSceneEnvelope } from '#validators/scene'

/**
 * Scena tablicy. Dokument sceny żyje w `board_scenes.document` (JSON),
 * kamera w `board_scenes.app_state`, a `version` to optymistyczna blokada.
 */
export default class ScenesController {
  /** GET /api/boards/:id/scene — scena lub pusty dokument (lazy init). */
  async show({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const board = await Board.find(params.id)
    if (!board || board.userId !== user.id) return response.notFound()

    const scene = await this.findOrCreate(board.id)

    return response.json({
      data: { document: scene.document, appState: scene.appState, version: scene.version },
    })
  }

  /** PUT /api/boards/:id/scene — zapis z optymistyczną blokadą (409 przy rozjeździe). */
  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const board = await Board.find(params.id)
    if (!board || board.userId !== user.id) return response.notFound()

    // Czytamy RAW JSON, żeby zachować bezstratność (bodyparser domyślnie
    // zamienia puste stringi na null, co obcięłoby dokument).
    const body = this.parseBody(request.raw())

    const { version, document, appState } = validateSceneEnvelope(body)
    const scene = await this.findOrCreate(board.id)

    if (scene.version !== version) {
      return response.status(409).json({
        error: 'Konflikt wersji sceny — tablica została zmieniona gdzie indziej',
        code: 'E_SCENE_VERSION_CONFLICT',
        currentVersion: scene.version,
      })
    }

    scene.document = document
    if (appState !== null) scene.appState = appState
    scene.version = version + 1
    await scene.save()

    return response.json({
      data: { document: scene.document, appState: scene.appState, version: scene.version },
    })
  }

  private async findOrCreate(boardId: number): Promise<BoardScene> {
    const existing = await BoardScene.query().where('board_id', boardId).first()
    if (existing) return existing

    return BoardScene.create({
      boardId,
      document: emptySceneDocument() as unknown as Record<string, unknown>,
      appState: {},
      version: 1,
    })
  }

  private parseBody(raw: string | null): unknown {
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      throw new Exception('Niepoprawny JSON w treści żądania', {
        status: 422,
        code: 'E_SCENE_INVALID_JSON',
      })
    }
  }
}
