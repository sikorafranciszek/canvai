import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'asset_analyses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('asset_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('assets')
        .onDelete('CASCADE')
      table.string('model').notNullable()
      table.string('status').notNullable().defaultTo('queued')
      table.text('summary').nullable()
      table.jsonb('tags').nullable()
      table.jsonb('palette').nullable()
      table.text('ocr_text').nullable()
      table.jsonb('raw').nullable()
      table.integer('tokens_in').nullable()
      table.integer('tokens_out').nullable()
      table.string('prompt_version').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['asset_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
