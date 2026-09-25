import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Board from '#models/board'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export default class BoardScene extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare document: Record<string, unknown>

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare appState: Record<string, unknown>

  @column()
  declare version: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: false, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Board)
  declare board: BelongsTo<typeof Board>
}
