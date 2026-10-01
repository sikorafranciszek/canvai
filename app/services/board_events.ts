import { PassThrough } from 'node:stream'

/**
 * Zdarzenia tablicy na żywo (Server-Sent Events) w pamięci procesu:
 * - `scene`    — nowa wersja sceny (klienci dociągają ją i scalają),
 * - `assets`   — zmiana materiałów,
 * - `doc`      — nowa wersja DESIGN.md,
 * - `comments` — zmiana komentarzy,
 * - `presence` — kto jest na tablicy,
 * - `cursor`   — pozycja kursora uczestnika (w układzie sceny).
 *
 * Jedna instancja aplikacji (tak działa wdrożenie) — przy wielu instancjach
 * hub trzeba przenieść na Redis pub/sub albo Postgres LISTEN/NOTIFY.
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
}

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

const g = globalThis as unknown as { __canvaiBoardHub?: Map<number, Map<string, Connection>> }
const boards: Map<number, Map<string, Connection>> = (g.__canvaiBoardHub ??= new Map())

function write(stream: PassThrough, event: string, data: unknown) {
  stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function colorFor(userId: number): string {
  return COLORS[userId % COLORS.length]
}

/** Wysyła zdarzenie do wszystkich uczestników tablicy (poza nadawcą). */
export function publish(
  boardId: number,
  event: string,
  data: Record<string, unknown>,
  exceptClientId?: string | null
) {
  const conns = boards.get(boardId)
  if (!conns) return
  for (const conn of conns.values()) {
    if (exceptClientId && conn.clientId === exceptClientId) continue
    write(conn.stream, event, data)
  }
}

export function participants(boardId: number): Participant[] {
  const seen = new Set<number>()
  const out: Participant[] = []
  for (const c of boards.get(boardId)?.values() ?? []) {
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
  publish(boardId, 'presence', { participants: participants(boardId) })
}

/** Rejestruje połączenie SSE; zwraca strumień do wysłania i funkcję sprzątającą. */
export function connect(boardId: number, participant: Participant) {
  const stream = new PassThrough()
  let conns = boards.get(boardId)
  if (!conns) {
    conns = new Map()
    boards.set(boardId, conns)
  }
  // Ponowne połączenie z tym samym clientId zastępuje stare.
  conns.get(participant.clientId)?.stream.end()
  conns.set(participant.clientId, { ...participant, stream, lastCursorAt: 0 })

  stream.write('retry: 3000\n\n')
  write(stream, 'hello', { clientId: participant.clientId, participants: participants(boardId) })
  broadcastPresence(boardId)

  // Komentarz co 25 s — proxy nie zamyka bezczynnego połączenia.
  const heartbeat = setInterval(() => stream.write(': ping\n\n'), 25_000)
  heartbeat.unref()

  const close = () => {
    clearInterval(heartbeat)
    const current = boards.get(boardId)
    if (current?.get(participant.clientId)?.stream === stream) {
      current.delete(participant.clientId)
      if (current.size === 0) boards.delete(boardId)
      broadcastPresence(boardId)
    }
    stream.end()
  }
  return { stream, close }
}

/** Kursor uczestnika (ograniczenie do ~20/s na klienta). */
export function moveCursor(boardId: number, clientId: string, x: number, y: number): boolean {
  const conn = boards.get(boardId)?.get(clientId)
  if (!conn) return false
  const now = Date.now()
  if (now - conn.lastCursorAt < 45) return true
  conn.lastCursorAt = now
  publish(
    boardId,
    'cursor',
    { clientId, userId: conn.userId, name: conn.name, color: conn.color, x, y },
    clientId
  )
  return true
}

/** Liczba otwartych połączeń (diagnostyka, testy). */
export function connectionCount(boardId?: number): number {
  if (boardId != null) return boards.get(boardId)?.size ?? 0
  let n = 0
  for (const c of boards.values()) n += c.size
  return n
}
