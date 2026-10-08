import { DateTime } from 'luxon'
import type Board from '#models/board'
import { publish } from '#services/board_events'

/**
 * Zaakceptowana („kontraktowa”) wersja DESIGN.md (FEAT-4). Akceptuje klient
 * w portalu albo zespół; REST v1 i MCP domyślnie serwują tę wersję, a nowa
 * generacja ponad nią wymaga potwierdzenia.
 */
export interface Approval {
  version: number
  by: string | null
  at: string | null
}

export function approvalOf(board: Board): Approval | null {
  return board.approvedVersion == null
    ? null
    : {
        version: board.approvedVersion,
        by: board.approvedBy,
        at: board.approvedAt?.toISO() ?? null,
      }
}

export async function setApproval(board: Board, version: number | null, by: string | null) {
  board.approvedVersion = version
  board.approvedBy = version == null ? null : (by?.slice(0, 120) ?? null)
  board.approvedAt = version == null ? null : DateTime.utc()
  await board.save()
  // Inni na tablicy widzą zmianę bez odświeżania (lista wersji pobiera stan od nowa).
  publish(board.id, 'doc', { version: version ?? 0, status: 'approval' })
}
