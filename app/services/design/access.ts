import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import { renderExport, type ExportFormat } from '#services/design/exports'

/**
 * Odczyt tablic i dokumentów dla klientów zewnętrznych (REST v1, MCP) —
 * zawsze w granicach właściciela.
 */
export async function listBoards(userId: number) {
  const boards = await Board.query().where('user_id', userId).orderBy('updated_at', 'desc')
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
  const board = await Board.find(boardId)
  if (!board || board.userId !== userId) return { board: null, doc: null }
  const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
  const doc = version
    ? await query.where('version', version).first()
    : await query.orderBy('version', 'desc').first()
  return { board, doc }
}

export function tokensFor(doc: DesignDoc, format: ExportFormat) {
  return doc.spec ? renderExport(doc.spec, format) : null
}
