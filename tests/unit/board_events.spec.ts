import { test } from '@japa/runner'
import {
  LIMITS,
  connect,
  connectionCount,
  disconnectUser,
  moveCursor,
  publish,
  type Participant,
} from '#services/board_events'

/** SEC-6: tożsamość połączeń, limity, odcinanie i wolni klienci. */

let nextBoard = 900_000
function board() {
  return nextBoard++
}

function who(userId: number, clientId: string): Participant {
  return {
    clientId,
    userId,
    name: `u${userId}`,
    initials: 'U',
    color: '#000',
    role: 'editor',
  }
}

function open(boardId: number, p: Participant) {
  const conn = connect(boardId, p)
  let text = ''
  let ended = false
  conn.stream.on('data', (chunk) => (text += chunk.toString()))
  conn.stream.on('end', () => (ended = true))
  return {
    ...conn,
    events: (name: string) => text.split(`event: ${name}\n`).length - 1,
    get ended() {
      return ended
    },
  }
}

const tick = () => new Promise((r) => setImmediate(r))

test.group('board events hub (SEC-6)', () => {
  test('cudzy clientId nie przejmuje połączenia innego użytkownika', async ({ assert }) => {
    const b = board()
    const victim = open(b, who(1, 'shared-client-id'))
    const attacker = open(b, who(2, 'shared-client-id'))
    await tick()
    assert.isFalse(victim.ended)
    assert.notEqual(attacker.clientId, 'shared-client-id')
    assert.equal(connectionCount(b), 2)
    victim.close()
    attacker.close()
  })

  test('ten sam użytkownik z tym samym clientId zastępuje stare połączenie', async ({ assert }) => {
    const b = board()
    const first = open(b, who(1, 'tab-client-1'))
    const second = open(b, who(1, 'tab-client-1'))
    await tick()
    assert.isTrue(first.ended)
    assert.isFalse(second.ended)
    assert.equal(connectionCount(b), 1)
    second.close()
  })

  test('kursor i wykluczenie nadawcy działają tylko dla właściciela clientId', async ({
    assert,
  }) => {
    const b = board()
    const owner = open(b, who(1, 'owner-client'))
    const other = open(b, who(2, 'other-client'))
    await tick()

    assert.isFalse(moveCursor(b, 'owner-client', 2, 10, 10))
    assert.isTrue(moveCursor(b, 'owner-client', 1, 10, 10))

    // Cudzy X-Client-Id nie wycisza powiadomień właściciela.
    publish(b, 'comments', {}, 'owner-client', 2)
    publish(b, 'assets', {}, 'owner-client', 1)
    await tick()
    assert.equal(owner.events('comments'), 1)
    assert.equal(owner.events('assets'), 0)
    assert.equal(other.events('assets'), 1)
    owner.close()
    other.close()
  })

  test('limit połączeń na użytkownika zamyka najstarsze', async ({ assert }) => {
    const b = board()
    const conns = Array.from({ length: LIMITS.perUser + 2 }, (_, i) =>
      open(b, who(7, `limit-client-${i}`))
    )
    await tick()
    assert.equal(connectionCount(b), LIMITS.perUser)
    assert.isTrue(conns[0].ended)
    assert.isTrue(conns[1].ended)
    assert.isFalse(conns.at(-1)!.ended)
    disconnectUser(7)
  })

  test('pełna tablica odmawia nowych połączeń', async ({ assert }) => {
    const b = board()
    const before = LIMITS.perBoard
    LIMITS.perBoard = 3
    try {
      for (let i = 0; i < 3; i++) open(b, who(100 + i, `full-client-${i}`))
      const rejected = open(b, who(200, 'full-client-x'))
      await tick()
      assert.isTrue(rejected.ended)
      assert.equal(connectionCount(b), 3)
    } finally {
      LIMITS.perBoard = before
      for (let i = 0; i < 3; i++) disconnectUser(100 + i)
    }
  })

  test('disconnectUser odcina użytkownika na wskazanej tablicy', async ({ assert }) => {
    const a = board()
    const c = board()
    const onA = open(a, who(5, 'cut-client-a'))
    const onC = open(c, who(5, 'cut-client-c'))
    const keep = open(a, who(6, 'cut-client-k'))
    await tick()
    assert.equal(disconnectUser(5, a), 1)
    await tick()
    assert.isTrue(onA.ended)
    assert.isFalse(onC.ended)
    assert.isFalse(keep.ended)
    assert.equal(disconnectUser(5), 1)
    keep.close()
  })

  test('klient, który nie odbiera, jest rozłączany zamiast puchnąć w pamięci', async ({
    assert,
  }) => {
    const b = board()
    // Bez czytelnika danych — bufor rośnie.
    const slow = connect(b, who(9, 'slow-client-1'))
    const big = { blob: 'x'.repeat(64 * 1024) }
    for (let i = 0; i < 40 && connectionCount(b) > 0; i++) publish(b, 'scene', big)
    await tick()
    assert.isTrue(slow.stream.writableEnded)
    assert.equal(connectionCount(b), 0)
  })
})
