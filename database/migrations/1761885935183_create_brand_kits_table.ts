import { BaseSchema } from '@adonisjs/lucid/schema'

/** Brand kity: kolory, fonty i zasady marki zapisane z DESIGN.md do ponownego użycia. */
export default class extends BaseSchema {
  protected tableName = 'brand_kits'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('name', 120).notNullable()
      table.json('colors').notNullable()
      table.json('fonts').notNullable()
      table.json('rules').notNullable()
      table.integer('source_board_id').unsigned().nullable()
      table.integer('source_version').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
