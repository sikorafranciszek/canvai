import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Podgląd UI: przykładowa strona HTML zbudowana z wersji DESIGN.md.
 * Rozliczany kredytami tak jak generacja — rezerwacja w `credit_transactions`
 * wskazuje podgląd (`design_preview_id`).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('design_previews', (table) => {
      table.increments('id').notNullable()
      table
        .integer('design_doc_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('design_docs')
        .onDelete('CASCADE')
      table.string('status', 20).notNullable()
      table.text('html', 'mediumtext').nullable()
      table.text('error').nullable()
      table.string('model', 80).nullable()
      table.integer('credits_charged').nullable()
      table.integer('job_id').unsigned().nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('generated_at').nullable()

      table.index(['design_doc_id'])
    })

    this.schema.alterTable('credit_transactions', (table) => {
      table.integer('design_preview_id').unsigned().nullable()
      table.index(['design_preview_id'])
    })
  }

  async down() {
    this.schema.alterTable('credit_transactions', (table) => {
      table.dropIndex(['design_preview_id'])
      table.dropColumn('design_preview_id')
    })
    this.schema.dropTable('design_previews')
  }
}
