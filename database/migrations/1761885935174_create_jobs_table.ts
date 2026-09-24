import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('type').notNullable()
      table.jsonb('payload').notNullable().defaultTo('{}')
      table.string('status').notNullable().defaultTo('queued')
      table.integer('attempts').notNullable().defaultTo(0)
      table.timestamp('run_at').nullable()
      table.timestamp('locked_at').nullable()
      table.text('last_error').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
