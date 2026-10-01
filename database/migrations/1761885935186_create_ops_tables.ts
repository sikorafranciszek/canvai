import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Zaplecze: dzienne zużycie modelu (bezpieczniki kosztów) i stan zadań
 * cyklicznych (kopie zapasowe, maile) — żeby restart nie powtarzał zadania.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_usage_daily', (table) => {
      table.date('day').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.bigInteger('tokens_in').notNullable().defaultTo(0)
      table.bigInteger('tokens_out').notNullable().defaultTo(0)
      table.integer('generations').notNullable().defaultTo(0)
      table.primary(['day', 'user_id'])
    })

    this.schema.createTable('scheduler_runs', (table) => {
      table.string('task', 60).primary()
      table.timestamp('last_run_at').nullable()
      table.string('last_status', 20).nullable()
      table.text('last_message').nullable()
    })
  }

  async down() {
    this.schema.dropTable('scheduler_runs')
    this.schema.dropTable('ai_usage_daily')
  }
}
