import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Indeksy pod listę tablic i wątki komentarzy (ARC-2); usunięcie dubli
 * (board_scenes.board_id ma już unikalny indeks, jobs(status) pokrywa jobs_claim_idx).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('boards', (table) => {
      table.index(['user_id', 'updated_at'], 'boards_user_updated_idx')
    })
    this.schema.alterTable('board_comments', (table) => {
      table.index(['parent_id'], 'board_comments_parent_idx')
    })
    this.defer(async (db) => {
      await db.rawQuery('drop index if exists board_scenes_board_id_index')
      await db.rawQuery('drop index if exists jobs_status_index')
    })
  }

  async down() {
    this.schema.alterTable('boards', (table) => {
      table.dropIndex(['user_id', 'updated_at'], 'boards_user_updated_idx')
    })
    this.schema.alterTable('board_comments', (table) => {
      table.dropIndex(['parent_id'], 'board_comments_parent_idx')
    })
    this.defer(async (db) => {
      await db.rawQuery(
        'create index if not exists board_scenes_board_id_index on board_scenes (board_id)'
      )
      await db.rawQuery('create index if not exists jobs_status_index on jobs (status)')
    })
  }
}
