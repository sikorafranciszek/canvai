import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Jedna scena na tablicę (DAT-1). Wcześniej równoległe „utwórz, jeśli brak”
 * mogły założyć dwie — zostawiamy tę z najwyższą wersją (potem najnowszą).
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(`
        delete from board_scenes s
        using board_scenes keep
        where s.board_id = keep.board_id
          and (s.version < keep.version or (s.version = keep.version and s.id < keep.id))
      `)
    })
    this.schema.alterTable('board_scenes', (table) => {
      table.unique(['board_id'])
    })
  }

  async down() {
    this.schema.alterTable('board_scenes', (table) => {
      table.dropUnique(['board_id'])
    })
  }
}
