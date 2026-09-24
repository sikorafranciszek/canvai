import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Board from '#models/board'

export default class DesignDoc extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare version: number

  @column()
  declare status: 'queued' | 'running' | 'ready' | 'failed'

  @column()
  declare contentMd: string | null

  @column()
  declare model: string | null

  @column()
  declare promptVersion: string | null

  @column()
  declare inputFingerprint: string | null

  @column()
  declare error: string | null

  @column.dateTime()
  declare generatedAt: DateTime | null

  @belongsTo(() => Board)
  declare board: BelongsTo<typeof Board>
}
