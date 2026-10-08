import { BaseSchema } from '@adonisjs/lucid/schema'

/** Fragment zrzutu jako osobny materiał (FEAT-3): z którego materiału pochodzi. */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('assets', (table) => {
      table.integer('crop_of').nullable().references('id').inTable('assets').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('assets', (table) => {
      table.dropColumn('crop_of')
    })
  }
}
