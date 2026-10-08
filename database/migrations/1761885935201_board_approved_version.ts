import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Zaakceptowana („kontraktowa”) wersja DESIGN.md (FEAT-4) — domyślna dla
 * REST v1 i MCP; uwaga klienta z portalu może dotyczyć jednej sekcji.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('boards', (table) => {
      table.integer('approved_version').nullable()
      table.string('approved_by', 120).nullable()
      table.timestamp('approved_at').nullable()
    })
    this.schema.alterTable('portal_feedback', (table) => {
      table.string('section', 30).nullable()
    })
  }

  async down() {
    this.schema.alterTable('boards', (table) => {
      table.dropColumn('approved_version')
      table.dropColumn('approved_by')
      table.dropColumn('approved_at')
    })
    this.schema.alterTable('portal_feedback', (table) => {
      table.dropColumn('section')
    })
  }
}
