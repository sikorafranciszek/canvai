import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

/**
 * Baza aplikacji: PostgreSQL (konta, tablice, dokumenty, kredyty, kolejka zadań…).
 * Połączenie `sqlite` zostaje wyłącznie jako ŹRÓDŁO jednorazowego importu
 * danych sprzed migracji na Postgresa (`node ace db:import-sqlite`).
 */
const dbConfig = defineConfig({
  connection: env.get('DB_CONNECTION', 'pg'),

  connections: {
    pg: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST', '127.0.0.1'),
        port: env.get('DB_PORT', 5432),
        user: env.get('DB_USER', 'canvai'),
        password: env.get('DB_PASSWORD', ''),
        database: env.get('DB_DATABASE', 'canvai'),
        ssl: env.get('DB_SSL', false) ? { rejectUnauthorized: false } : undefined,
      },
      pool: { min: 0, max: env.get('DB_POOL_MAX', 10) },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      debug: env.get('DB_DEBUG', false),
    },

    /** Tylko import danych ze starej bazy SQLite (plik z wolumenu). */
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: env.get('SQLITE_PATH', app.tmpPath('db.sqlite3')),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
