import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Wpis dziennika kredytów (tylko dopisywany):
 * - `grant` (+) przyznanie puli, `revoke` (−) cofnięcie (zwrot płatności),
 * - `reserve` (−) rezerwacja na generację, `release` (+) zwrot niewykorzystanej
 *   rezerwacji. Zużycie = rezerwacja − zwroty dla danego dokumentu.
 */
export type CreditTransactionKind = 'grant' | 'revoke' | 'reserve' | 'release'

export default class CreditTransaction extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare kind: CreditTransactionKind

  @column()
  declare amount: number

  @column()
  declare grantId: number | null

  @column()
  declare designDocId: number | null

  @column()
  declare designPreviewId: number | null

  @column()
  declare note: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
