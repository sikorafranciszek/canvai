import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Współpraca: członkowie tablicy (role, zaproszenia mailem) i komentarze
 * przypięte do miejsca na płótnie (wątki, rozwiązywanie).
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('board_members', (table) => {
      table.increments('id').notNullable()
      table
        .integer('board_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('email', 254).notNullable()
      table.string('role', 10).notNullable()
      table.string('token', 64).notNullable().unique()
      table
        .integer('invited_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('accepted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.unique(['board_id', 'email'])
      table.index(['user_id'])
    })

    this.schema.createTable('board_comments', (table) => {
      table.increments('id').notNullable()
      table
        .integer('board_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('boards')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('board_comments')
        .onDelete('CASCADE')
      table.float('x').nullable()
      table.float('y').nullable()
      table.text('body').notNullable()
      table.timestamp('resolved_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.index(['board_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('board_comments')
    this.schema.dropTable('board_members')
  }
}
