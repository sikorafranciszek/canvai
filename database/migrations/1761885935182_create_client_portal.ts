import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Portal klienta: link udostępniania tablicy (`/c/<token>`), skrzynka
 * materiałów od klienta (`assets.inbox`) i decyzje klienta o DESIGN.md.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('board_shares', (table) => {
      table.increments('id').notNullable()
      table
        .integer('board_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table.string('token', 48).notNullable().unique()
      table.boolean('allow_upload').notNullable().defaultTo(true)
      table.boolean('show_doc').notNullable().defaultTo(true)
      table.timestamp('revoked_at').nullable()
      table.timestamp('created_at').notNullable()
    })

    this.schema.alterTable('assets', (table) => {
      table.boolean('inbox').notNullable().defaultTo(false)
      table.string('submitted_by', 120).nullable()
    })

    this.schema.createTable('portal_feedback', (table) => {
      table.increments('id').notNullable()
      table
        .integer('board_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table.integer('design_doc_id').unsigned().nullable()
      table.integer('version').nullable()
      table.string('decision', 20).notNullable()
      table.string('name', 120).notNullable()
      table.text('comment').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['board_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('portal_feedback')
    this.schema.alterTable('assets', (table) => {
      table.dropColumn('inbox')
      table.dropColumn('submitted_by')
    })
    this.schema.dropTable('board_shares')
  }
}
