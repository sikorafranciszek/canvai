import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type PortalDecision = 'approved' | 'changes' | 'note'

/** Decyzja klienta o wersji DESIGN.md (akceptacja albo prośba o zmiany). */
export default class PortalFeedback extends BaseModel {
  static table = 'portal_feedback'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare designDocId: number | null

  @column()
  declare version: number | null

  @column()
  declare decision: PortalDecision

  @column()
  declare name: string

  @column()
  declare comment: string | null

  /** Sekcja, której dotyczy uwaga (FEAT-4) — `null` = cały dokument. */
  @column()
  declare section: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
