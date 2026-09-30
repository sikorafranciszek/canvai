import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Notatka zespołu o użytkowniku (CRM). */
export default class CrmNote extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare authorId: number | null

  @column()
  declare body: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
