import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'design_docs'

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
      table.integer('version').notNullable().defaultTo(1)
      table.string('status').notNullable().defaultTo('queued')
      table.text('content_md').nullable()
      table.string('model').nullable()
      table.string('prompt_version').nullable()
      table.string('input_fingerprint').nullable()
      table.text('error').nullable()
      table.timestamp('generated_at').nullable()

      table.index(['board_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
