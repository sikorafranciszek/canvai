import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type MemberRole = 'editor' | 'viewer'

/** Członek tablicy (zaproszenie mailem; `userId` po przyjęciu). */
export default class BoardMember extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare boardId: number

  @column()
  declare userId: number | null

  @column()
  declare email: string

  @column()
  declare role: MemberRole

  @column({ serializeAs: null })
  declare token: string

  @column()
  declare invitedById: number | null

  @column.dateTime()
  declare acceptedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
