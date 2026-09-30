import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Rozliczenia: kredyty i subskrypcje (Lemon Squeezy).
 *
 * - `credit_grants` — pule kredytów z datą ważności; `remaining` maleje przy
 *   zużyciu. `external_id` (unikalny) chroni przed podwójnym naliczeniem przy
 *   powtórzonym webhooku lub równoległym żądaniu.
 * - `credit_transactions` — dziennik tylko do dopisywania (rezerwacja, zużycie,
 *   zwrot, przyznanie) — audyt i rozliczenie rezerwacji per dokument.
 * - `subscriptions` — lustro subskrypcji z Lemon Squeezy (status, odnowienie).
 * - `design_docs` — `spec` (do eksportów), `credits_charged`, `pro_mode`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('credit_grants', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('source', 30).notNullable()
      table.integer('amount').notNullable()
      table.integer('remaining').notNullable()
      table.timestamp('expires_at').nullable()
      table.string('external_id', 120).nullable().unique()
      table.timestamp('revoked_at').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'expires_at'])
    })

    this.schema.createTable('credit_transactions', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('kind', 20).notNullable()
      table.integer('amount').notNullable()
      table.integer('grant_id').unsigned().nullable()
      table.integer('design_doc_id').unsigned().nullable()
      table.string('note', 200).nullable()
      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'created_at'])
      table.index(['design_doc_id'])
    })

    this.schema.createTable('subscriptions', (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('provider', 20).notNullable().defaultTo('lemonsqueezy')
      table.string('external_id', 60).notNullable().unique()
      table.string('customer_id', 60).nullable()
      table.string('variant_id', 60).nullable()
      table.string('plan', 20).notNullable()
      table.string('status', 20).notNullable()
      table.timestamp('renews_at').nullable()
      table.timestamp('ends_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_id'])
    })

    this.schema.alterTable('design_docs', (table) => {
      table.json('spec').nullable()
      table.integer('credits_charged').nullable()
      table.boolean('pro_mode').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('design_docs', (table) => {
      table.dropColumn('spec')
      table.dropColumn('credits_charged')
      table.dropColumn('pro_mode')
    })
    this.schema.dropTable('subscriptions')
    this.schema.dropTable('credit_transactions')
    this.schema.dropTable('credit_grants')
  }
}
