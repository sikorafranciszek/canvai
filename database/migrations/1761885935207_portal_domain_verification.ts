import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * SEC-10: własna domena portalu dopiero po weryfikacji rekordem TXT.
 * Unikalność tylko wśród zweryfikowanych — zgłoszenie nie blokuje cudzej domeny.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.dropUnique(['portal_domain'])
      table.string('portal_domain_token', 64).nullable()
      table.timestamp('portal_domain_verified_at').nullable()
    })
    this.schema.raw(
      'create unique index users_portal_domain_verified on users (portal_domain) where portal_domain_verified_at is not null'
    )
  }

  async down() {
    this.schema.raw('drop index if exists users_portal_domain_verified')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('portal_domain_token')
      table.dropColumn('portal_domain_verified_at')
      table.unique(['portal_domain'])
    })
  }
}
