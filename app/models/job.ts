import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export default class Job extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare type: string

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare payload: Record<string, unknown>

  @column()
  declare status: JobStatus

  @column()
  declare attempts: number

  @column.dateTime()
  declare runAt: DateTime | null

  @column.dateTime()
  declare lockedAt: DateTime | null

  @column()
  declare lastError: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
