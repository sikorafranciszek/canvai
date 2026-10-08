import { test } from '@japa/runner'
import { AutosaveEngine, AutosaveConflictError, type SaveStatus } from '#shared/autosave'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface Doc {
  v: string
}

test.group('AutosaveEngine', () => {
  test('debounce — wiele schedule() koliduje w jeden save z najnowszym stanem', async ({
    assert,
  }) => {
    const calls: Array<{ version: number; document: Doc }> = []
    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 20,
        save: async (p) => {
          calls.push({ version: p.version, document: p.document })
          return p.version + 1
        },
        reload: async () => ({ version: 1, document: { v: 'x' }, appState: {} }),
        onStatus: () => {},
        onConflict: () => {},
      },
      1
    )

    engine.schedule({ v: 'a' }, {})
    engine.schedule({ v: 'b' }, {})
    engine.schedule({ v: 'c' }, {})

    await sleep(70)

    assert.lengthOf(calls, 1)
    assert.deepEqual(calls[0].document, { v: 'c' })
    assert.equal(calls[0].version, 1)
    engine.dispose()
  })

  test('sukces — inkrementuje wersję i raportuje saving → saved', async ({ assert }) => {
    const statuses: SaveStatus[] = []
    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 1,
        save: async (p) => p.version + 1,
        reload: async () => ({ version: 0, document: { v: 'x' }, appState: {} }),
        onStatus: (s) => statuses.push(s),
        onConflict: () => {},
      },
      3
    )

    engine.schedule({ v: 'hello' }, {})
    await engine.flush()

    assert.equal(engine.currentVersion, 4)
    assert.deepEqual(statuses, ['saving', 'saved'])
    engine.dispose()
  })

  test('konflikt 409 — pobiera świeżą wersję, rebase i jeden ponowny zapis', async ({ assert }) => {
    const statuses: SaveStatus[] = []
    const conflicts: number[] = []
    let saveCalls = 0

    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 1,
        save: async (p) => {
          saveCalls++
          if (saveCalls === 1) throw new AutosaveConflictError(5)
          return p.version + 1
        },
        reload: async () => ({ version: 5, document: { v: 'server' }, appState: {} }),
        onStatus: (s) => statuses.push(s),
        onConflict: (fresh) => conflicts.push(fresh.version),
      },
      4
    )

    engine.schedule({ v: 'local' }, {})
    await engine.flush()

    assert.equal(saveCalls, 2)
    assert.deepEqual(conflicts, [5])
    assert.equal(engine.currentVersion, 6)
    assert.deepEqual(statuses, ['saving', 'saved'])
    engine.dispose()
  })

  test('podwójny konflikt — drugi rebase też się nie udaje → status error (bez pętli)', async ({
    assert,
  }) => {
    const statuses: SaveStatus[] = []
    const conflicts: number[] = []
    let saveCalls = 0

    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 1,
        save: async () => {
          saveCalls++
          throw new AutosaveConflictError(5)
        },
        reload: async () => ({ version: 5, document: { v: 'server' }, appState: {} }),
        onStatus: (s) => statuses.push(s),
        onConflict: (fresh) => conflicts.push(fresh.version),
      },
      4
    )

    engine.schedule({ v: 'local' }, {})
    await engine.flush()

    assert.equal(saveCalls, 2)
    assert.deepEqual(conflicts, [5])
    assert.deepEqual(statuses, ['saving', 'error'])
    assert.equal(engine.currentVersion, 5)
    engine.dispose()
  })

  test('błąd sieci — raportuje error i nie zmienia wersji', async ({ assert }) => {
    const statuses: SaveStatus[] = []
    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 1,
        save: async () => {
          throw new Error('network down')
        },
        reload: async () => ({ version: 0, document: { v: 'x' }, appState: {} }),
        onStatus: (s) => statuses.push(s),
        onConflict: () => {},
      },
      2
    )

    engine.schedule({ v: 'a' }, {})
    await engine.flush()

    assert.deepEqual(statuses, ['saving', 'error'])
    assert.equal(engine.currentVersion, 2)
    engine.dispose()
  })

  test('DAT-5: błąd sieci nie gubi zmian — ponowienie z odstępem i retryNow()', async ({
    assert,
  }) => {
    let online = false
    const saved: Doc[] = []
    const statuses: SaveStatus[] = []
    const engine = new AutosaveEngine<Doc, Record<string, unknown>>(
      {
        debounceMs: 1,
        retryDelaysMs: [15],
        save: async (p) => {
          if (!online) throw new Error('network down')
          saved.push(p.document)
          return p.version + 1
        },
        reload: async () => ({ version: 1, document: { v: 'x' }, appState: {} }),
        onStatus: (s) => statuses.push(s),
        onConflict: () => {},
      },
      1
    )
    engine.schedule({ v: 'draft' }, {})
    await sleep(10)
    assert.isTrue(engine.failing)
    assert.isTrue(engine.hasPending, 'dokument czeka w kolejce')
    assert.include(statuses, 'error')

    online = true
    await sleep(40)
    assert.deepEqual(saved, [{ v: 'draft' }], 'automatyczne ponowienie')
    assert.isFalse(engine.failing)

    // Nowsza edycja w trakcie awarii zastępuje starszy stan (pełny dokument).
    online = false
    engine.schedule({ v: 'a' }, {})
    await sleep(5)
    engine.schedule({ v: 'b' }, {})
    online = true
    await engine.retryNow()
    assert.deepEqual(saved.at(-1), { v: 'b' })
    engine.dispose()
  })
})
