import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Blokada doradcza tablicy do końca transakcji — serializuje tworzenie wersji
 * DESIGN.md (generacja, ręczna edycja) na jednej tablicy (DAT-2).
 */
const LOCK_BOARD_DOCS = 7201

export async function lockBoard(trx: TransactionClientContract, boardId: number) {
  await trx.rawQuery('select pg_advisory_xact_lock(?, ?)', [LOCK_BOARD_DOCS, boardId])
}
