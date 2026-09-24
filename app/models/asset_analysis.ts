import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Asset from '#models/asset'

export default class AssetAnalysis extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare assetId: number

  @column()
  declare model: string

  @column()
  declare status: string

  @column()
  declare summary: string | null

  @column()
  declare tags: Record<string, unknown> | null

  @column()
  declare palette: Record<string, unknown> | null

  @column()
  declare ocrText: string | null

  @column()
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
