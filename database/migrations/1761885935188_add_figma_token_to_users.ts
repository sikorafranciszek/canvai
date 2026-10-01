import { BaseSchema } from '@adonisjs/lucid/schema'

/** Osobisty token Figmy (zaszyfrowany kluczem aplikacji) — import ramek i stylów. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.text('figma_token').nullable()
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('figma_token')
    })
  }
}
