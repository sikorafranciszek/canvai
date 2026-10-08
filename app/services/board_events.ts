import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { sendBus, type BusMessage } from '#services/live_bus'

/**
 * Zdarzenia tablicy na żywo (Server-Sent Events) w pamięci procesu:
 * - `scene`    — nowa wersja sceny (klienci dociągają ją i scalają),
 * - `assets`   — zmiana materiałów,
 * - `doc`      — nowa wersja DESIGN.md,
 * - `comments` — zmiana komentarzy,
 * - `presence` — kto jest na tablicy,
 * - `cursor`   — pozycja kursora uczestnika (w układzie sceny).
 *
 * Wiele instancji (ARC-4): przy `LIVE_EVENTS_BUS=postgres` zdarzenia idą też
 * przez Postgres LISTEN/NOTIFY (`live_bus.ts`) — każda instancja doręcza je
 * swoim połączeniom; obecność z innych instancji jest scalana i wygasa.
 */

export interface Participant {
  clientId: string
  userId: number
  name: string
  initials: string
  color: string
  role: string
}

interface Connection extends Participant {
  stream: PassThrough
  lastCursorAt: number
  openedAt: number
  close: () => void
}

/** Limity połączeń (SEC-6): na użytkownika (wszystkie tablice) i na tablicę. */
export const LIMITS = { perUser: 10, perBoard: 100 }
/** Bufor wolnego klienta: powyżej — bez kursorów, powyżej MAX — rozłączenie. */
const SOFT_BUFFER = 256 * 1024
const MAX_BUFFER = 2 * 1024 * 1024

const COLORS = [
  '#c0622d',
  '#016a71',
  '#7a4b6b',
  '#3f6282',
  '#557a55',
  '#b8862b',
  '#a33a24',
  '#4b5aa8',
]

const g = globalThis as unknown as {
  __canvaiBoardHub?: Map<number, Map<string, Connection>>
  __canvaiRemotePresence?: Map<number, Map<string, { participants: Participant[]; at: number }>>
}
const boards: Map<number, Map<string, Connection>> = (g.__canvaiBoardHub ??= new Map())
/** Obecność z innych instancji: tablica → instancja → uczestnicy (ARC-4). */
const remotePresence = (g.__canvaiRemotePresence ??= new Map())
/** Po tylu ms bez odświeżenia obecność innej instancji wygasa (padnięta instancja). */
export const REMOTE_PRESENCE_TTL = 90_000

function write(conn: Connection, event: string, data: unknown) {
  const buffered = conn.stream.writableLength
  if (buffered > MAX_BUFFER) {
    // Klient nie odbiera (zawieszona karta, wolne łącze) — rozłączamy, wróci przez retry.
    conn.close()
    return
  }
  if (event === 'cursor' && buffered > SOFT_BUFFER) return
  conn.stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function colorFor(userId: number): string {
  return COLORS[userId % COLORS.length]
}

/**
 * Wysyła zdarzenie do wszystkich uczestników tablicy poza nadawcą. Nadawca jest
 * pomijany TYLKO, gdy podany clientId należy do tego samego użytkownika —
 * cudzy X-Client-Id nie wyłączy nikomu powiadomień (SEC-6).
 */
export function publish(
  boardId: number,
  event: string,
  data: Record<string, unknown>,
  exceptClientId?: string | null,
  senderUserId?: number | null
) {
  deliverLocal(boardId, event, data, exceptClientId, senderUserId)
  sendBus({ k: 'pub', b: boardId, e: event, d: data, x: exceptClientId, u: senderUserId })
}

function deliverLocal(
  boardId: number,
  event: string,
  data: Record<string, unknown>,
  exceptClientId?: string | null,
  senderUserId?: number | null
) {
  const conns = boards.get(boardId)
  if (!conns) return
  for (const conn of [...conns.values()]) {
    if (exceptClientId && conn.clientId === exceptClientId && conn.userId === senderUserId) continue
    write(conn, event, data)
  }
}

/** Uczestnicy połączeni z TĄ instancją (bez obecności z innych). */
function localParticipants(boardId: number): Participant[] {
  return [...(boards.get(boardId)?.values() ?? [])].map((c) => ({
    clientId: c.clientId,
    userId: c.userId,
    name: c.name,
    initials: c.initials,
    color: c.color,
    role: c.role,
  }))
}

export function participants(boardId: number): Participant[] {
  const seen = new Set<number>()
  const out: Participant[] = []
  const now = Date.now()
  const remote = [...(remotePresence.get(boardId)?.values() ?? [])]
    .filter((r) => now - r.at < REMOTE_PRESENCE_TTL)
    .flatMap((r) => r.participants)
  for (const c of [...localParticipants(boardId), ...remote]) {
    if (seen.has(c.userId)) continue
    seen.add(c.userId)
    out.push({
      clientId: c.clientId,
      userId: c.userId,
      name: c.name,
      initials: c.initials,
      color: c.color,
      role: c.role,
    })
  }
  return out
}

function broadcastPresence(boardId: number) {
  deliverLocal(boardId, 'presence', { participants: participants(boardId) })
  sendBus({ k: 'presence', b: boardId, p: localParticipants(boardId) })
}

/** Okresowe odświeżenie obecności dla innych instancji i wygaszenie martwych. */
export function refreshPresence() {
  const now = Date.now()
  for (const boardId of boards.keys()) {
    sendBus({ k: 'presence', b: boardId, p: localParticipants(boardId) })
  }
  for (const [boardId, byInstance] of remotePresence) {
    let changed = false
    for (const [origin, entry] of byInstance) {
      if (now - entry.at >= REMOTE_PRESENCE_TTL) {
        byInstance.delete(origin)
        changed = true
      }
    }
    if (byInstance.size === 0) remotePresence.delete(boardId)
    if (changed) deliverLocal(boardId, 'presence', { participants: participants(boardId) })
  }
}

/** Wiadomość od innej instancji (ARC-4). */
export function handleBusMessage(message: BusMessage, origin: string) {
  switch (message.k) {
    case 'pub':
      deliverLocal(message.b, message.e, message.d, message.x, message.u)
      return
    case 'presence': {
      const byInstance = remotePresence.get(message.b) ?? new Map()
      if (message.p.length)
        byInstance.set(origin, { participants: message.p as Participant[], at: Date.now() })
      else byInstance.delete(origin)
      if (byInstance.size) remotePresence.set(message.b, byInstance)
      else remotePresence.delete(message.b)
      deliverLocal(message.b, 'presence', { participants: participants(message.b) })
      return
    }
    case 'disconnect':
      disconnectLocal(message.u, message.b)
  }
}

function connectionsOf(userId: number): Connection[] {
  const out: Connection[] = []
  for (const conns of boards.values())
    for (const c of conns.values()) if (c.userId === userId) out.push(c)
  return out
}

/** Rejestruje połączenie SSE; zwraca strumień do wysłania i funkcję sprzątającą. */
export function connect(boardId: number, requested: Participant) {
  const stream = new PassThrough()
  let conns = boards.get(boardId)
  if (!conns) {
    conns = new Map()
    boards.set(boardId, conns)
  }
  // clientId innego użytkownika nie przejmuje jego połączenia — dostajemy nowy.
  const taken = conns.get(requested.clientId)
  const participant =
    taken && taken.userId !== requested.userId
      ? { ...requested, clientId: randomUUID() }
      : requested
  // Ponowne połączenie tego samego klienta zastępuje stare.
  conns.get(participant.clientId)?.close()

  // Limity: najstarsze połączenia użytkownika ustępują nowym; pełna tablica odmawia.
  const mine = connectionsOf(participant.userId).sort((a, b) => a.openedAt - b.openedAt)
  while (mine.length >= LIMITS.perUser) mine.shift()!.close()
  if ((boards.get(boardId)?.size ?? 0) >= LIMITS.perBoard) {
    stream.end('retry: 30000\n\n')
    return { stream, close: () => {}, clientId: participant.clientId }
  }
  conns = boards.get(boardId) ?? new Map()
  boards.set(boardId, conns)

  let closed = false
  const heartbeat = setInterval(() => stream.write(': ping\n\n'), 25_000)
  heartbeat.unref()
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    const current = boards.get(boardId)
    if (current?.get(participant.clientId)?.stream === stream) {
      current.delete(participant.clientId)
      if (current.size === 0) boards.delete(boardId)
      broadcastPresence(boardId)
    }
    stream.end()
  }
  const conn: Connection = { ...participant, stream, lastCursorAt: 0, openedAt: Date.now(), close }
  conns.set(participant.clientId, conn)

  stream.write('retry: 3000\n\n')
  write(conn, 'hello', { clientId: participant.clientId, participants: participants(boardId) })
  broadcastPresence(boardId)
  return { stream, close, clientId: participant.clientId }
}

/** Zamyka strumienie użytkownika (usunięcie z tablicy, blokada konta) — SEC-6. */
export function disconnectUser(userId: number, boardId?: number): number {
  sendBus({ k: 'disconnect', u: userId, b: boardId })
  return disconnectLocal(userId, boardId)
}

function disconnectLocal(userId: number, boardId?: number): number {
  let n = 0
  for (const [id, conns] of boards) {
    if (boardId != null && id !== boardId) continue
    for (const c of [...conns.values()]) {
      if (c.userId !== userId) continue
      c.close()
      n++
    }
  }
  return n
}

/** Kursor uczestnika (ograniczenie do ~20/s na klienta). */
export function moveCursor(
  boardId: number,
  clientId: string,
  userId: number,
  x: number,
  y: number
): boolean {
  const conn = boards.get(boardId)?.get(clientId)
  // Kursor tylko z własnego połączenia — nie da się poruszać cudzym (SEC-6).
  if (!conn || conn.userId !== userId) return false
  const now = Date.now()
  if (now - conn.lastCursorAt < 45) return true
  conn.lastCursorAt = now
  publish(
    boardId,
    'cursor',
    { clientId, userId: conn.userId, name: conn.name, color: conn.color, x, y },
    clientId,
    userId
  )
  return true
}

/**
 * Zamyka wszystkie strumienie (zamykanie procesu). Otwarte SSE trzymają
 * połączenia HTTP, przez co `server.close()` czekałby w nieskończoność;
 * klienci połączą się ponownie z nową instancją (retry).
 */
export function closeAll(): number {
  let n = 0
  for (const conns of [...boards.values()]) {
    for (const c of [...conns.values()]) {
      c.close()
      n++
    }
  }
  return n
}

/** Liczba otwartych połączeń (diagnostyka, testy). */
export function connectionCount(boardId?: number): number {
  if (boardId != null) return boards.get(boardId)?.size ?? 0
  let n = 0
  for (const c of boards.values()) n += c.size
  return n
}
