import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Link portalu klienta dla tablicy (`/c/<token>`). */
export default class BoardShare extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare token: string

  @column({ consume: (v) => Boolean(v) })
  declare allowUpload: boolean

  @column({ consume: (v) => Boolean(v) })
  declare showDoc: boolean

  @column.dateTime()
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
