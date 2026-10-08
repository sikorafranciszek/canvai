import { BaseSchema } from '@adonisjs/lucid/schema'

/** Alerty administratora w bazie (REL-5): przetrwają awarię procesu, widoczne w CRM. */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ops_alerts', (table) => {
      table.string('key', 200).primary()
      table.text('message').notNullable()
      table.integer('count').notNullable().defaultTo(1)
      table.timestamp('first_at').notNullable()
      table.timestamp('last_at').notNullable()
      table.index(['last_at'])
    })
  }

  async down() {
    this.schema.dropTable('ops_alerts')
  }
}
