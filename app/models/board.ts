import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class Board extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare title: string

  @column()
  declare slug: string

  /** Przykładowa tablica nowego konta (nie liczy się do limitu planu). */
  @column({ consume: (v) => Boolean(v) })
  declare isSample: boolean

  /** Zaakceptowana wersja DESIGN.md (FEAT-4): domyślna dla REST v1 i MCP. */
  @column()
  declare approvedVersion: number | null

  /** Kto zaakceptował: imię z portalu albo nazwa członka zespołu. */
  @column()
  declare approvedBy: string | null

  @column.dateTime()
  declare approvedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
