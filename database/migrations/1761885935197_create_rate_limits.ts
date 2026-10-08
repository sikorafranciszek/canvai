import { BaseSchema } from '@adonisjs/lucid/schema'

/** Liczniki limitów żądań w bazie (SEC-4): wspólne dla procesów, przetrwają restart. */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('rate_limits', (table) => {
      table.string('key', 200).primary()
      table.integer('hits').notNullable()
      table.timestamp('reset_at').notNullable()
      table.index(['reset_at'])
    })
  }

  async down() {
    this.schema.dropTable('rate_limits')
  }
}
