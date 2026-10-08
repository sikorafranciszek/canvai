import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Właściciel blokady zadania (DAT-3): zakończenie, postęp i odzyskanie zadania
 * działają tylko dla procesu, który je trzyma. Indeks pod pobieranie zadań.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.string('locked_by', 64).nullable()
      table.index(['status', 'run_at', 'id'], 'jobs_claim_idx')
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropIndex(['status', 'run_at', 'id'], 'jobs_claim_idx')
      table.dropColumn('locked_by')
    })
  }
}
