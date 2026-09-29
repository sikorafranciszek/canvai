import { BaseSchema } from '@adonisjs/lucid/schema'

/** Preferowany język interfejsu i maili (null = wg cookie / przeglądarki). */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('locale', 5).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('locale')
    })
  }
}
