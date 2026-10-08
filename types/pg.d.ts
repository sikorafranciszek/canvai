/**
 * Minimalne typy `pg` dla szyny zdarzeń (ARC-4) — pakiet nie ma własnych typów,
 * a Lucid używa go przez knex. Tylko to, czego używa `app/services/live_bus.ts`.
 */
declare module 'pg' {
  export interface ClientConfig {
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
    ssl?: unknown
  }

  export interface Notification {
    channel: string
    payload?: string
  }

  export class Client {
    constructor(config?: ClientConfig)
    connect(): Promise<void>
    query(sql: string, params?: unknown[]): Promise<unknown>
    end(): Promise<void>
    on(event: 'notification', listener: (msg: Notification) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'end', listener: () => void): this
  }

  const pg: { Client: typeof Client }
  export default pg
}
