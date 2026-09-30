import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * CRM: blokowanie kont, tagi użytkowników i notatki zespołu.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.timestamp('disabled_at').nullable()
      table.json('crm_tags').nullable()
    })

    this.schema.createTable('crm_notes', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.integer('author_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('body').notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('crm_notes')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('disabled_at')
      table.dropColumn('crm_tags')
    })
  }
}
