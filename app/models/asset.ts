import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Board from '#models/board'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export default class Asset extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare kind: 'image' | 'pdf' | 'link' | 'text' | 'file'

  @column()
  declare filename: string

  @column()
  declare mime: string | null

  @column()
  declare size: number | null

  @column({ columnName: 'sha256' })
  declare sha256: string | null

  @column()
  declare storageKey: string | null

  @column()
  declare thumbKey: string | null

  @column()
  declare analysisKey: string | null

  @column()
  declare width: number | null

  @column()
  declare height: number | null

  @column()
  declare source: 'paste' | 'drop' | 'upload' | 'url' | null

  @column()
  declare userNote: string | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare position: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Board)
  declare board: BelongsTo<typeof Board>
}
