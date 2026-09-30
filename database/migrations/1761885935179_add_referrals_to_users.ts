import { BaseSchema } from '@adonisjs/lucid/schema'

/** Polecenia: kod polecający użytkownika i kto go polecił. */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('referral_code', 16).nullable().unique()
      table
        .integer('referred_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('referred_by_id')
      table.dropColumn('referral_code')
    })
  }
}
