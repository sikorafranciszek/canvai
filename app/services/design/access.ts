import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import { renderExport, type ExportFormat } from '#services/design/exports'
import { boardAccess, memberBoardIds } from '#services/board_access'
import { entitlementsFor } from '#services/billing/plans'

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
    // Zaakceptowana wersja (FEAT-4) ma pierwszeństwo przed najnowszą.
    const doc =
      (b.approvedVersion != null &&
        docs.find((d) => d.boardId === b.id && d.version === b.approvedVersion)) ||
      docs.find((d) => d.boardId === b.id)
    return {
      id: b.id,
      title: b.title,
      updatedAt: b.updatedAt?.toISO() ?? null,
      designMd: doc
        ? {
            version: doc.version,
            generatedAt: doc.generatedAt?.toISO() ?? null,
            approved: doc.version === b.approvedVersion,
          }
        : null,
    }
  })
}

/**
 * Czy wersja mieści się w limicie historii planu właściciela tablicy. Jedna
 * reguła dla UI, REST v1 i MCP (SEC-12) — starsze wersje są ukryte wszędzie.
 */
export async function versionVisible(ownerId: number, boardId: number, version: number) {
  const { limits } = await entitlementsFor(ownerId)
  if (limits.versionsKept == null) return true
  const newer = await DesignDoc.query()
    .where('board_id', boardId)
    .where('version', '>', version)
    .count('* as total')
  return Number(newer[0].$extras.total) < limits.versionsKept
}

export async function readyDoc(userId: number, boardId: number, version?: number) {
  const board = (await boardAccess(userId, boardId, 'view'))?.board
  if (!board) return { board: null, doc: null }
  const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
  // Bez numeru: wersja zaakceptowana (FEAT-4), a gdy jej nie ma — najnowsza gotowa.
  const doc = version
    ? await query.where('version', version).first()
    : ((board.approvedVersion != null
        ? await query.clone().where('version', board.approvedVersion).first()
        : null) ?? (await query.orderBy('version', 'desc').first()))
  // Wersja kontraktowa jest widoczna zawsze, niezależnie od limitu historii planu.
  if (
    doc &&
    doc.version !== board.approvedVersion &&
    !(await versionVisible(board.userId, board.id, doc.version))
  ) {
    return { board, doc: null }
  }
  return { board, doc }
}

export function tokensFor(doc: DesignDoc, format: ExportFormat) {
  return doc.spec ? renderExport(doc.spec, format) : null
}
