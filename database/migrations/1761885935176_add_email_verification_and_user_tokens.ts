import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Konta: weryfikacja e-mail i tokeny jednorazowe (weryfikacja, reset hasła).
 *
 * - `users.email_verified_at` — null = adres niepotwierdzony. Konta istniejące
 *   przed tą migracją uznajemy za zweryfikowane (data utworzenia konta).
 * - `user_tokens` — trzymamy WYŁĄCZNIE hash sha256 tokenu; surowy token trafia
 *   tylko do maila. Token jest jednorazowy (`used_at`) i ma termin ważności.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.timestamp('email_verified_at').nullable()
    })
    this.defer(async (db) => {
      await db.from('users').whereNull('email_verified_at').update({
        email_verified_at: db.raw('created_at'),
      })
    })

    this.schema.createTable('user_tokens', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('type', 40).notNullable()
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at').notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'type'])
    })
  }

  async down() {
    this.schema.dropTable('user_tokens')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('email_verified_at')
    })
  }
}
