import { BaseSchema } from '@adonisjs/lucid/schema'

/** Przykładowa tablica nowego konta — nie liczy się do limitu tablic planu. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('boards', (table) => {
      table.boolean('is_sample').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('boards', (table) => {
      table.dropColumn('is_sample')
    })
  }
}
