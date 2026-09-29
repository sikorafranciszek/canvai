/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database
  DB_CONNECTION: Env.schema.enum(['sqlite', 'pg', 'mysql', 'mssql'] as const),
  DB_HOST: Env.schema.string.optional(),
  DB_PORT: Env.schema.number.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),

  // AI (M3: analiza assetów → DESIGN.md)
  // Bez klucza pipeline działa na dostawcy `mock` — aplikacja startuje normalnie.
  AI_PROVIDER: Env.schema.enum.optional(['mock', 'deepseek'] as const),
  DEEPSEEK_API_KEY: Env.schema.string.optional(),
  DEEPSEEK_BASE_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  DEEPSEEK_VISION_MODEL: Env.schema.string.optional(),
  DEEPSEEK_TEXT_MODEL: Env.schema.string.optional(),
  DEEPSEEK_REASONING_MODEL: Env.schema.string.optional(),

  // Kolejka: worker in-process w `node ace serve` (domyślnie włączony).
  QUEUE_INLINE_WORKER: Env.schema.boolean.optional(),
})
