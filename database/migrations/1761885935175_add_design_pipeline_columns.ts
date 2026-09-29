import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M3: kolumny potrzebne pipeline'owi AI → DESIGN.md.
 *
 * - `asset_analyses.cache_key` — klucz treści (sha256 pliku albo hash linku);
 *   razem z `model` i `prompt_version` wyznacza trafienie w cache analizy.
 * - `design_docs.usage` — tokeny, liczba assetów, czas generacji.
 * - `design_docs.sources` — mapowanie asset → sekcje (sekcja 8 dokumentu).
 * - `design_docs.created_at` — kiedy generację zlecono.
 * - `design_docs.job_id` — zadanie kolejki (postęp generacji).
 * - `jobs.created_at` / `jobs.updated_at` — diagnostyka kolejki.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('asset_analyses', (table) => {
      table.string('cache_key').nullable()
      table.index(['cache_key', 'model', 'prompt_version'])
    })

    this.schema.alterTable('design_docs', (table) => {
      table.jsonb('usage').nullable()
      table.jsonb('sources').nullable()
      table.timestamp('created_at').nullable()
      table.integer('job_id').nullable()
    })

    this.schema.alterTable('jobs', (table) => {
      table.timestamp('created_at').nullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('created_at')
      table.dropColumn('updated_at')
    })

    this.schema.alterTable('design_docs', (table) => {
      table.dropColumn('usage')
      table.dropColumn('sources')
      table.dropColumn('created_at')
      table.dropColumn('job_id')
    })

    this.schema.alterTable('asset_analyses', (table) => {
      table.dropIndex(['cache_key', 'model', 'prompt_version'])
      table.dropColumn('cache_key')
    })
  }
}
