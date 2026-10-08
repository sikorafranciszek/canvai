import Board from '#models/board'
import BoardMember from '#models/board_member'

/**
 * Dostęp do tablicy: właściciel albo przyjęty członek (edytor / podgląd).
 *
 * - `view`   — czytanie sceny, materiałów, DESIGN.md, eksportów, komentarze,
 * - `edit`   — zmiany sceny i materiałów, generacja (płaci właściciel tablicy),
 * - `manage` — tylko właściciel: nazwa, usunięcie, portal klienta, członkowie.
 *
 * Brak dostępu zwraca `null` — kontrolery odpowiadają 404 (nie zdradzamy,
 * że tablica istnieje).
 */

export type BoardRole = 'owner' | 'editor' | 'viewer'
export type BoardAction = 'view' | 'edit' | 'manage'

export function can(role: BoardRole, action: BoardAction): boolean {
  if (action === 'manage') return role === 'owner'
  if (action === 'edit') return role === 'owner' || role === 'editor'
  return true
}

export async function roleFor(userId: number, board: Board): Promise<BoardRole | null> {
  if (board.userId === userId) return 'owner'
  const member = await BoardMember.query()
    .where('board_id', board.id)
    .where('user_id', userId)
    .whereNotNull('accepted_at')
    .first()
  return member ? member.role : null
}

/** Tablica z rolą użytkownika, o ile rola pozwala na `action`. */
export async function boardAccess(
  userId: number,
  boardId: string | number,
  action: BoardAction = 'view'
): Promise<{ board: Board; role: BoardRole } | null> {
  const id = Number(boardId)
  if (!Number.isInteger(id) || id <= 0) return null
  const board = await Board.find(id)
  if (!board) return null
  const role = await roleFor(userId, board)
  if (!role) return null
  return can(role, action) ? { board, role } : null
}

/** Sama tablica (bez roli), gdy użytkownik może wykonać `action`; inaczej `null`. */
export async function accessibleBoard(
  userId: number,
  boardId: string | number,
  action: BoardAction = 'view'
): Promise<Board | null> {
  return (await boardAccess(userId, boardId, action))?.board ?? null
}

/** Jak `boardAccess`, ale rozróżnia brak dostępu (404) od braku uprawnień (403). */
export async function boardAccessOrStatus(
  userId: number,
  boardId: string | number,
  action: BoardAction
): Promise<{ board: Board; role: BoardRole } | 403 | 404> {
  const id = Number(boardId)
  if (!Number.isInteger(id) || id <= 0) return 404
  const board = await Board.find(id)
  if (!board) return 404
  const role = await roleFor(userId, board)
  if (!role) return 404
  return can(role, action) ? { board, role } : 403
}

/** Id tablic, do których użytkownik ma dostęp jako członek (bez własnych). */
export async function memberBoardIds(userId: number): Promise<Map<number, BoardRole>> {
  const rows = await BoardMember.query().where('user_id', userId).whereNotNull('accepted_at')
  return new Map(rows.map((m) => [m.boardId, m.role]))
}
