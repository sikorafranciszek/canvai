import { BaseSchema } from '@adonisjs/lucid/schema'

/** Wersja z polecenia (FEAT-2): treść polecenia i regenerowana sekcja. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('design_docs', (table) => {
      table.text('instruction').nullable()
      table.string('revised_section', 30).nullable()
    })
  }

  async down() {
    this.schema.alterTable('design_docs', (table) => {
      table.dropColumn('instruction')
      table.dropColumn('revised_section')
    })
  }
}
