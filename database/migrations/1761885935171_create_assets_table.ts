import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'assets'

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
      table.string('kind').notNullable()
      table.string('filename').notNullable()
      table.string('mime').nullable()
      table.bigInteger('size').nullable()
      table.string('sha256').nullable()
      table.string('storage_key').nullable()
      table.string('thumb_key').nullable()
      table.string('analysis_key').nullable()
      table.integer('width').nullable()
      table.integer('height').nullable()
      table.string('source').nullable()
      table.text('user_note').nullable()
      table.jsonb('position').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['board_id'])
      table.index(['sha256'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
