import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type CreditGrantSource = 'signup' | 'monthly_free' | 'pack' | 'subscription' | 'admin'

/** Pula kredytów z datą ważności — patrz `services/billing/credits.ts`. */
export default class CreditGrant extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare source: CreditGrantSource

  @column()
  declare amount: number

  @column()
  declare remaining: number

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column()
  declare externalId: string | null

  @column.dateTime()
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
