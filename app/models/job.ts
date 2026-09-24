import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Job extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare type: string

  @column()
  declare payload: Record<string, unknown>

  @column()
  declare status: string

  @column()
  declare attempts: number

  @column.dateTime()
  declare runAt: DateTime | null

  @column.dateTime()
  declare lockedAt: DateTime | null

  @column()
  declare lastError: string | null
}
