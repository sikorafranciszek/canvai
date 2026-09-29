import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Asset from '#models/asset'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

/**
 * Wynik etapu 1 pipeline'u (analiza pojedynczego assetu). Działa jak cache:
 * trafienie = ten sam `cacheKey` (treść) + `model` + `promptVersion`.
 */
export default class AssetAnalysis extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare assetId: number

  @column()
  declare cacheKey: string | null

  @column()
  declare model: string

  @column()
  declare promptVersion: string | null

  @column()
  declare status: 'queued' | 'ready' | 'failed'

  @column()
  declare summary: string | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare tags: string[] | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare palette: { hex: string; role?: string }[] | null

  @column()
  declare ocrText: string | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare raw: Record<string, unknown> | null

  @column()
  declare tokensIn: number | null

  @column()
  declare tokensOut: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Asset)
  declare asset: BelongsTo<typeof Asset>
}
