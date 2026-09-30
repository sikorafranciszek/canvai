import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import DesignDoc from '#models/design_doc'

export type DesignPreviewStatus = 'queued' | 'running' | 'ready' | 'failed'

/** Przykładowa strona HTML w stylu danej wersji DESIGN.md. */
export default class DesignPreview extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare designDocId: number

  @column()
  declare status: DesignPreviewStatus

  @column({ serializeAs: null })
  declare html: string | null

  @column()
  declare error: string | null

  @column()
  declare model: string | null

  @column()
  declare creditsCharged: number | null

  @column()
  declare jobId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare generatedAt: DateTime | null

  @belongsTo(() => DesignDoc)
  declare designDoc: BelongsTo<typeof DesignDoc>
}
