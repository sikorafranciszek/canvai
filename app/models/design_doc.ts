import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Board from '#models/board'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export type DesignDocStatus = 'queued' | 'running' | 'ready' | 'failed'

export interface DesignDocUsage {
  assets: number
  analyzed: number
  cached: number
  tokensIn: number
  tokensOut: number
  durationMs: number
}

/** Wiersz sekcji 8: który asset zasilił które sekcje. */
export interface DesignDocSource {
  assetId: number
  filename: string
  kind: string
  sections: number[]
}

export default class DesignDoc extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare version: number

  @column()
  declare status: DesignDocStatus

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

  @column()
  declare jobId: number | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare usage: DesignDocUsage | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare sources: DesignDocSource[] | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime()
  declare generatedAt: DateTime | null

  @belongsTo(() => Board)
  declare board: BelongsTo<typeof Board>
}
