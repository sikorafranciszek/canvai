import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * SEC-14: wersja sesji konta. Sesje w ciasteczku nie dają się odwołać po
 * stronie serwera — podbicie wersji (reset/zmiana hasła, „wyloguj wszędzie”)
 * unieważnia każdą sesję z inną wersją.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.integer('session_version').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('session_version')
    })
  }
}
