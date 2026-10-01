import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Zakupy firmowe (nazwa firmy i NIP przekazywane do checkoutu Polar → faktura)
 * oraz marka agencji (white-label: nazwa, logo, kolor, własna domena portalu).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.string('billing_company', 200).nullable()
      table.string('billing_tax_id', 40).nullable()
      table.string('brand_name', 80).nullable()
      table.string('brand_logo_key', 255).nullable()
      table.string('brand_accent', 9).nullable()
      table.string('portal_domain', 253).nullable().unique()
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('billing_company')
      table.dropColumn('billing_tax_id')
      table.dropColumn('brand_name')
      table.dropColumn('brand_logo_key')
      table.dropColumn('brand_accent')
      table.dropColumn('portal_domain')
    })
  }
}
