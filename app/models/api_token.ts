import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Token API (REST v1 / MCP) — patrz `services/api_tokens.ts`. */
export default class ApiToken extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare name: string

  @column()
  declare prefix: string

  @column({ serializeAs: null })
  declare tokenHash: string

  @column.dateTime()
  declare lastUsedAt: DateTime | null

  @column.dateTime()
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
