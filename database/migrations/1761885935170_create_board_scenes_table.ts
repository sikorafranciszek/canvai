import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'board_scenes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('board_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table.jsonb('document').notNullable().defaultTo('{}')
      table.jsonb('app_state').notNullable().defaultTo('{}')
      table.integer('version').notNullable().defaultTo(1)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['board_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
