import { randomUUID } from 'node:crypto'
import pg, { type Client, type ClientConfig } from 'pg'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import dbConfig from '#config/database'

/**
 * Szyna zdarzeń na żywo między instancjami (ARC-4): PostgreSQL LISTEN/NOTIFY.
 * Każda instancja publikuje zdarzenia tablic do kanału i doręcza swoim
 * klientom SSE to, co przyszło od innych. Bez zewnętrznego Redisa — baza i tak
 * jest wspólna. Włączana `LIVE_EVENTS_BUS=postgres`; domyślnie (jedna
 * instancja) wszystko zostaje w pamięci procesu.
 */
export const INSTANCE_ID = randomUUID()
export const LIVE_CHANNEL = 'canvai_live'
/** Limit NOTIFY to 8000 bajtów — większe zdarzenie zostaje lokalne (z ostrzeżeniem). */
const MAX_PAYLOAD = 7800

export type BusMessage =
  | {
      k: 'pub'
      b: number
      e: string
      d: Record<string, unknown>
      x?: string | null
      u?: number | null
    }
  | { k: 'presence'; b: number; p: unknown[] }
  | { k: 'disconnect'; u: number; b?: number }

type Handler = (message: BusMessage, origin: string) => void

const state = {
  enabled: false,
  client: null as Client | null,
  handler: null as Handler | null,
  stopping: false,
}

export function busEnabled(): boolean {
  return state.enabled
}

/** Wysyła wiadomość do pozostałych instancji (bez czekania; błąd tylko w logu). */
export function sendBus(message: BusMessage) {
  if (!state.enabled) return
  const payload = JSON.stringify({ ...message, o: INSTANCE_ID })
  if (Buffer.byteLength(payload) > MAX_PAYLOAD) {
    logger.warn(
      { kind: message.k, bytes: payload.length },
      'live bus: payload too large, kept local'
    )
    return
  }
  void db
    .rawQuery('select pg_notify(?, ?)', [LIVE_CHANNEL, payload])
    .catch((error) => logger.warn({ err: error }, 'live bus: notify failed'))
}

async function connect() {
  const config = dbConfig.connections.pg.connection as ClientConfig
  const client = new pg.Client(config)
  client.on('notification', (msg) => {
    if (msg.channel !== LIVE_CHANNEL || !msg.payload) return
    try {
      const { o, ...message } = JSON.parse(msg.payload) as BusMessage & { o: string }
      if (o !== INSTANCE_ID) state.handler?.(message as BusMessage, o)
    } catch (error) {
      logger.warn({ err: error }, 'live bus: bad payload')
    }
  })
  const reconnect = () => {
    if (state.stopping || state.client !== client) return
    state.client = null
    setTimeout(() => void connect().catch(() => reconnect()), 2000).unref()
  }
  client.on('error', (error) => {
    logger.warn({ err: error }, 'live bus: connection error')
    reconnect()
  })
  client.on('end', reconnect)
  await client.connect()
  await client.query(`LISTEN ${LIVE_CHANNEL}`)
  state.client = client
}

/** Start nasłuchu (serwer HTTP, gdy LIVE_EVENTS_BUS=postgres). */
export async function startLiveBus(handler: Handler) {
  state.handler = handler
  state.stopping = false
  await connect()
  state.enabled = true
  logger.info({ instance: INSTANCE_ID }, 'live bus: listening on Postgres')
}

export async function stopLiveBus() {
  state.stopping = true
  state.enabled = false
  const client = state.client
  state.client = null
  await client?.end().catch(() => {})
}
