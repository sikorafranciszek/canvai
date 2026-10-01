import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Maile cykliczne (przypomnienia, wygasające kredyty, podsumowanie tygodnia):
 * zgoda użytkownika i dziennik wysyłek — każdy mail najwyżej raz na (rodzaj, ref).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.boolean('marketing_emails').notNullable().defaultTo(true)
    })
    this.schema.createTable('email_log', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('kind', 40).notNullable()
      table.string('ref', 80).notNullable()
      table.timestamp('sent_at').notNullable()
      table.unique(['user_id', 'kind', 'ref'])
    })
  }

  async down() {
    this.schema.dropTable('email_log')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('marketing_emails')
    })
  }
}
