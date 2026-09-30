import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Płatności przez Polar.sh zamiast Lemon Squeezy: subskrypcja wskazuje
 * produkt Polar (`product_id`), a domyślny dostawca to `polar`.
 */
export default class extends BaseSchema {
  protected tableName = 'subscriptions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('variant_id', 'product_id')
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.string('provider', 20).notNullable().defaultTo('polar').alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('product_id', 'variant_id')
    })
  }
}
