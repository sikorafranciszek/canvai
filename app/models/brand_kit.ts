import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export interface BrandKitColor {
  name: string
  hex: string
  role: string
}

export interface BrandKitFont {
  name: string
  role: string
}

/** Zestaw marki zapisany z DESIGN.md — wstawiany na inne tablice jako notatka dla AI. */
export default class BrandKit extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare name: string

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare colors: BrandKitColor[]

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare fonts: BrandKitFont[]

  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare rules: string[]

  @column()
  declare sourceBoardId: number | null

  @column()
  declare sourceVersion: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
