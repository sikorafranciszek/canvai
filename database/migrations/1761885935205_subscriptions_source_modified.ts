import { BaseSchema } from '@adonisjs/lucid/schema'

/** SEC-15: czas zdarzenia Polar — spóźnione starsze zdarzenie nie nadpisze nowszego. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('subscriptions', (table) => {
      table.timestamp('source_modified_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('subscriptions', (table) => {
      table.dropColumn('source_modified_at')
    })
  }
}
