import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Board from '#models/board'
import { jsonConsume, jsonPrepare } from '#models/json_columns'
import { normalizeUsage, type AssetUsage } from '#shared/asset-usage'

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
  declare source: 'paste' | 'drop' | 'upload' | 'url' | 'crop' | null

  /** Materiał, z którego wycięto ten fragment (FEAT-3). */
  @column()
  declare cropOf: number | null

  @column()
  declare userNote: string | null

  /** Rola materiału w DESIGN.md: own | inspiration | avoid (null = AI decyduje). */
  @column()
  declare usageRole: string | null

  /** Aspekty do wzięcia z materiału (pusta lista = wszystko). */
  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare usageAspects: string[] | null

  get usage(): AssetUsage {
    return normalizeUsage(this.usageRole, this.usageAspects)
  }

  /** Materiał od klienta (portal), czeka na umieszczenie na płótnie przez właściciela. */
  @column({ consume: (v) => Boolean(v) })
  declare inbox: boolean

  /** Kto przysłał materiał przez portal klienta. */
  @column()
  declare submittedBy: string | null

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare position: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Board)
  declare board: BelongsTo<typeof Board>
}
