import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Jak użyć materiału w DESIGN.md: rola (nasz / inspiracja / anty-wzór)
 * i aspekty (kolory, typografia, układ, komponenty, grafika, teksty).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('assets', (table) => {
      table.string('usage_role', 12).nullable()
      table.json('usage_aspects').nullable()
    })
  }

  async down() {
    this.schema.alterTable('assets', (table) => {
      table.dropColumn('usage_role')
      table.dropColumn('usage_aspects')
    })
  }
}
