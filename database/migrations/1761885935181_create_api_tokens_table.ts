import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tokeny API (REST v1 i serwer MCP). Trzymamy tylko hash sha256; surowy token
 * użytkownik widzi raz, przy utworzeniu. `prefix` służy do rozpoznania w UI.
 */
export default class extends BaseSchema {
  protected tableName = 'api_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('name', 80).notNullable()
      table.string('prefix', 16).notNullable()
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('last_used_at').nullable()
      table.timestamp('revoked_at').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
