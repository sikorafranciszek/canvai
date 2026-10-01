import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Komentarz na tablicy: wątek główny z pozycją na płótnie albo odpowiedź (`parentId`). */
export default class BoardComment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare userId: number | null

  @column()
  declare parentId: number | null

  @column()
  declare x: number | null

  @column()
  declare y: number | null

  @column()
  declare body: string

  @column.dateTime()
  declare resolvedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: false, autoUpdate: true })
  declare updatedAt: DateTime | null
}
