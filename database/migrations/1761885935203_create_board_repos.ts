import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Repozytorium GitHub tablicy (FEAT-5): pull request z DESIGN.md, regułą
 * Cursora, CLAUDE.md i tokenami po akceptacji wersji. Token szyfrowany.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('board_repos', (table) => {
      table.increments('id')
      table
        .integer('board_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table.string('repo', 200).notNullable()
      table.string('base_branch', 200).notNullable().defaultTo('main')
      table.string('directory', 200).notNullable().defaultTo('')
      table.text('token').notNullable()
      table.boolean('auto_on_approve').notNullable().defaultTo(true)
      table.integer('last_version').nullable()
      table.string('last_pr_url', 500).nullable()
      table.string('last_error', 500).nullable()
      table.timestamp('last_synced_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('board_repos')
  }
}
