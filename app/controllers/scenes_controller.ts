import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import BoardScene from '#models/board_scene'
import { emptySceneDocument } from '#shared/scene'
import { validateSceneEnvelope } from '#validators/scene'
import { boardAccessOrStatus } from '#services/board_access'
import { publish } from '#services/board_events'

/**
 * Scena tablicy. Dokument sceny żyje w `board_scenes.document` (JSON),
 * kamera w `board_scenes.app_state`, a `version` to optymistyczna blokada.
 */
export default class ScenesController {
  /** GET /api/boards/:id/scene — scena lub pusty dokument (lazy init). */
  async show({ auth, params, response }: HttpContext) {
    const access = await boardAccessOrStatus(auth.user!.id, params.id, 'view')
    if (typeof access === 'number') return response.status(access).send('')
    const { board } = access

    const scene = await this.findOrCreate(board.id)

    return response.json({
      data: { document: scene.document, appState: scene.appState, version: scene.version },
    })
  }

  /** PUT /api/boards/:id/scene — zapis z optymistyczną blokadą (409 przy rozjeździe). */
  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const access = await boardAccessOrStatus(user.id, params.id, 'edit')
    if (typeof access === 'number') return response.status(access).send('')
    const { board } = access

    // Czytamy RAW JSON, żeby zachować bezstratność (bodyparser domyślnie
    // zamienia puste stringi na null, co obcięłoby dokument).
    const body = this.parseBody(request.raw())

    const { version, document, appState } = validateSceneEnvelope(body)
    const before = await this.findOrCreate(board.id)

    // Zapis warunkowy w JEDNYM poleceniu (DAT-1): dwa równoległe PUT z tą samą
    // wersją nie mogą oba przejść — drugi dostaje 409 zamiast nadpisać pierwszy.
    const saved = await db.rawQuery(
      `update board_scenes
          set document = ?::jsonb,
              app_state = coalesce(?::jsonb, app_state),
              version = version + 1,
              updated_at = now()
        where board_id = ? and version = ?
        returning version, document, app_state`,
      [
        JSON.stringify(document),
        appState === null ? null : JSON.stringify(appState),
        board.id,
        version,
      ]
    )
    const row = saved.rows[0] as
      { version: number; document: unknown; app_state: unknown } | undefined
    if (!row) {
      const current = await BoardScene.query().where('board_id', board.id).first()
      return response.status(409).json({
        error: 'Konflikt wersji sceny — tablica została zmieniona gdzie indziej',
        code: 'E_SCENE_VERSION_CONFLICT',
        currentVersion: current?.version ?? before.version,
      })
    }

    // Pozostali uczestnicy dociągają nową wersję i scalają ją ze swoimi zmianami
    // (sam ruch kamery nie zmienia treści — nie budzimy innych).
    if (!sameJson(before.document, document)) {
      publish(
        board.id,
        'scene',
        { version: row.version, by: user.id },
        request.header('x-client-id')
      )
    }

    return response.json({
      data: { document: row.document, appState: row.app_state, version: row.version },
    })
  }

  /** Scena tablicy; brakującą zakłada bez wyścigu (unikalne board_id + ON CONFLICT). */
  private async findOrCreate(boardId: number): Promise<BoardScene> {
    const existing = await BoardScene.query().where('board_id', boardId).first()
    if (existing) return existing
    await db
      .table('board_scenes')
      .insert({
        board_id: boardId,
        document: JSON.stringify(emptySceneDocument()),
        app_state: JSON.stringify({}),
        version: 1,
        created_at: new Date(),
      })
      .onConflict('board_id')
      .ignore()
    return BoardScene.query().where('board_id', boardId).firstOrFail()
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

/** Porównanie dokumentów niezależne od kolejności kluczy (jsonb ją zmienia). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])])
          )
        : v
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}
