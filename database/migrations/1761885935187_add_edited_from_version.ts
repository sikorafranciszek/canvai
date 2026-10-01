import { BaseSchema } from '@adonisjs/lucid/schema'

/** Wersje DESIGN.md z ręcznej edycji tokenów (bez generacji AI). */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('design_docs', (table) => {
      table.integer('edited_from_version').nullable()
    })
  }

  async down() {
    this.schema.alterTable('design_docs', (table) => {
      table.dropColumn('edited_from_version')
    })
  }
}
