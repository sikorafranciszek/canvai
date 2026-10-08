import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Repozytorium GitHub tablicy (FEAT-5). `token` zaszyfrowany (`encryption`). */
export default class BoardRepo extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  /** `owner/name`. */
  @column()
  declare repo: string

  @column()
  declare baseBranch: string

  /** Katalog na DESIGN.md i tokeny (`''` = korzeń repozytorium). */
  @column()
  declare directory: string

  @column({ serializeAs: null })
  declare token: string

  @column({ consume: (v) => Boolean(v) })
  declare autoOnApprove: boolean

  @column()
  declare lastVersion: number | null

  @column()
  declare lastPrUrl: string | null

  @column()
  declare lastError: string | null

  @column.dateTime()
  declare lastSyncedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
