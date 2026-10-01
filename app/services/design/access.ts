import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import { renderExport, type ExportFormat } from '#services/design/exports'
import { boardAccess, memberBoardIds } from '#services/board_access'

/**
 * Odczyt tablic i dokumentów dla klientów zewnętrznych (REST v1, MCP) —
 * tablice własne i te, do których użytkownik został zaproszony.
 */
export async function listBoards(userId: number) {
  const shared = await memberBoardIds(userId)
  const boards = await Board.query()
    .where((q) => {
      q.where('user_id', userId)
      if (shared.size) q.orWhereIn('id', [...shared.keys()])
    })
    .orderBy('updated_at', 'desc')
  const docs = boards.length
    ? await DesignDoc.query()
        .whereIn(
          'board_id',
          boards.map((b) => b.id)
        )
        .where('status', 'ready')
        .orderBy('version', 'desc')
    : []
  return boards.map((b) => {
    const doc = docs.find((d) => d.boardId === b.id)
    return {
      id: b.id,
      title: b.title,
      updatedAt: b.updatedAt?.toISO() ?? null,
      designMd: doc
        ? { version: doc.version, generatedAt: doc.generatedAt?.toISO() ?? null }
        : null,
    }
  })
}

export async function readyDoc(userId: number, boardId: number, version?: number) {
  const board = (await boardAccess(userId, boardId, 'view'))?.board
  if (!board) return { board: null, doc: null }
  const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
  const doc = version
    ? await query.where('version', version).first()
    : await query.orderBy('version', 'desc').first()
  return { board, doc }
}

export function tokensFor(doc: DesignDoc, format: ExportFormat) {
  return doc.spec ? renderExport(doc.spec, format) : null
}
