import { test } from '@japa/runner'
import pg, { type Client, type ClientConfig } from 'pg'
import dbConfig from '#config/database'
import {
  connect,
  handleBusMessage,
  participants,
  publish,
  REMOTE_PRESENCE_TTL,
  refreshPresence,
} from '#services/board_events'
import { INSTANCE_ID, LIVE_CHANNEL, startLiveBus, stopLiveBus } from '#services/live_bus'

/**
 * ARC-4: dwie instancje — ta (szyna w procesie testu) i „druga” symulowana
 * osobnym połączeniem Postgresa, które wysyła i odbiera NOTIFY jak inna instancja.
 * Bez globalnej transakcji: NOTIFY dociera dopiero po zatwierdzeniu.
 */
test.group('Szyna zdarzeń między instancjami (ARC-4)', (group) => {
  let other: Client
  const received: { o: string; k: string; e?: string; b?: number; p?: unknown[] }[] = []

  group.setup(async () => {
    await startLiveBus(handleBusMessage)
    other = new pg.Client(dbConfig.connections.pg.connection as ClientConfig)
    await other.connect()
    other.on('notification', (msg) => {
      if (msg.channel === LIVE_CHANNEL && msg.payload) received.push(JSON.parse(msg.payload))
    })
    await other.query(`LISTEN ${LIVE_CHANNEL}`)
    return async () => {
      await other.end()
      await stopLiveBus()
    }
  })

  const wait = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
    return check()
  }

  test('zdarzenie z innej instancji trafia do lokalnego klienta SSE i odwrotnie', async ({
    assert,
  }) => {
    const boardId = 900_000 + Math.floor(Math.random() * 1000)
    const local = connect(boardId, {
      clientId: 'local-client',
      userId: 1,
      name: 'Ola',
      initials: 'O',
      color: '#000',
      role: 'owner',
    })
    let text = ''
    local.stream.on('data', (chunk: Buffer) => (text += chunk.toString()))
    try {
      // Inna instancja publikuje zmianę sceny → klient tej instancji ją dostaje.
      const remote = { o: 'other-instance', k: 'pub', b: boardId, e: 'scene', d: { version: 7 } }
      await other.query(`select pg_notify('${LIVE_CHANNEL}', $1)`, [JSON.stringify(remote)])
      assert.isTrue(await wait(() => text.includes('event: scene')), 'scene z innej instancji')
      assert.include(text, '"version":7')

      // Publikacja tutaj → druga instancja dostaje ją z naszym identyfikatorem.
      publish(boardId, 'doc', { version: 3, status: 'ready' })
      assert.isTrue(
        await wait(() => received.some((m) => m.k === 'pub' && m.e === 'doc' && m.b === boardId))
      )
      assert.equal(received.find((m) => m.e === 'doc')!.o, INSTANCE_ID)

      // Obecność: użytkownik z innej instancji widoczny tutaj, wygasa po TTL.
      handleBusMessage(
        {
          k: 'presence',
          b: boardId,
          p: [
            {
              clientId: 'r',
              userId: 2,
              name: 'Edek',
              initials: 'E',
              color: '#111',
              role: 'editor',
            },
          ],
        },
        'other-instance'
      )
      assert.sameMembers(
        participants(boardId).map((p) => p.userId),
        [1, 2]
      )
      assert.include(text, '"name":"Edek"')
      const realNow = Date.now
      Date.now = () => realNow() + REMOTE_PRESENCE_TTL + 1000
      try {
        refreshPresence()
      } finally {
        Date.now = realNow
      }
      assert.deepEqual(
        participants(boardId).map((p) => p.userId),
        [1]
      )
      // Odświeżenie obecności dotarło też do drugiej instancji.
      assert.isTrue(
        await wait(() =>
          received.some((m) => m.k === 'presence' && m.b === boardId && (m.p?.length ?? 0) === 1)
        )
      )
    } finally {
      local.close()
    }
  })
})
