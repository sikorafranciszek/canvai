import { test } from '@japa/runner'
import { hasLocalChanges, mergeScenes } from '#shared/scene-merge'
import type { SceneDocument, SceneElement } from '#shared/scene'

const rect = (id: string, x = 0, fill = '#fff'): SceneElement =>
  ({
    id,
    type: 'rectangle',
    x,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    fill,
    stroke: '#000',
    strokeWidth: 1,
  }) as SceneElement
const doc = (...elements: SceneElement[]): SceneDocument => ({ elements, metadata: {} })

test.group('Scalanie scen (współpraca na żywo)', () => {
  test('bez lokalnych zmian wynik = stan zdalny', ({ assert }) => {
    const base = doc(rect('a'))
    const remote = doc(rect('a', 50), rect('b'))
    assert.strictEqual(mergeScenes(base, base, remote), remote)
    assert.isFalse(hasLocalChanges(base, base))
  })

  test('zmiany obu stron w różnych elementach łączą się', ({ assert }) => {
    const base = doc(rect('a'), rect('b'))
    const local = doc(rect('a', 10), rect('b'), rect('local-new'))
    const remote = doc(rect('a'), rect('b', 99), rect('remote-new'))
    const merged = mergeScenes(base, local, remote)
    assert.deepEqual(
      merged.elements.map((e) => [e.id, e.x]),
      [
        ['a', 10],
        ['b', 99],
        ['remote-new', 0],
        ['local-new', 0],
      ]
    )
  })

  test('usunięcia: lokalne usuwa, zdalne usunięcie nie kasuje lokalnej zmiany', ({ assert }) => {
    const base = doc(rect('a'), rect('b'), rect('c'))
    const local = doc(rect('a'), rect('c', 5)) // usunięte b, zmienione c
    const remote = doc(rect('a'), rect('b')) // usunięte c
    const merged = mergeScenes(base, local, remote)
    assert.deepEqual(
      merged.elements.map((e) => e.id),
      ['a', 'c']
    )
    assert.equal(merged.elements[1].x, 5)
  })

  test('ten sam element zmieniony po obu stronach — wygrywa lokalna zmiana', ({ assert }) => {
    const base = doc(rect('a'))
    const merged = mergeScenes(base, doc(rect('a', 1, '#f00')), doc(rect('a', 2, '#0f0')))
    assert.equal(merged.elements[0].x, 1)
  })
})

test.group('Scalanie per właściwość (DAT-7)', () => {
  test('różne właściwości tego samego elementu łączą się; ta sama — wygrywa lokalna', ({
    assert,
  }) => {
    const base = doc(rect('a', 0, '#fff'))
    const local = doc({ ...rect('a', 40, '#fff'), y: 5 } as SceneElement)
    const remote = doc({ ...rect('a', 0, '#f00'), y: 9 } as SceneElement)
    const [el] = mergeScenes(base, local, remote).elements as (SceneElement & { fill: string })[]
    assert.equal(el.x, 40, 'lokalne przesunięcie')
    assert.equal(el.fill, '#f00', 'zdalny kolor')
    assert.equal(el.y, 5, 'ta sama właściwość — lokalna')
  })

  test('lokalne usunięcie nie kasuje zdalnej edycji; niezmieniony element znika', ({ assert }) => {
    const base = doc(rect('a'), rect('b'))
    const local = doc()
    const remote = doc(rect('a', 0, '#0f0'), rect('b'))
    const merged = mergeScenes(base, local, remote)
    assert.deepEqual(
      merged.elements.map((e) => e.id),
      ['a'],
      'a zmieniony zdalnie zostaje, b usunięty'
    )
  })

  test('lokalna zmiana kolejności zachowana, nowy zdalny element za swoim poprzednikiem', ({
    assert,
  }) => {
    const base = doc(rect('a'), rect('b'), rect('c'))
    const local = doc(rect('c'), rect('a'), rect('b'))
    const remote = doc(rect('a'), rect('r'), rect('b'), rect('c'))
    const merged = mergeScenes(base, local, remote)
    assert.deepEqual(
      merged.elements.map((e) => e.id),
      ['c', 'a', 'r', 'b']
    )
    assert.isTrue(hasLocalChanges(base, local), 'sama kolejność to też zmiana')
  })

  test('historia cofania przeliczona na nowej bazie nie cofa cudzej pracy', ({ assert }) => {
    // Lokalnie: przesunięcie a (x 0 → 10 → 20); historia trzyma stan x=10.
    const base = doc(rect('a', 0), rect('b'))
    const undoState = doc(rect('a', 10), rect('b'))
    const remote = doc(rect('a', 0), rect('b', 0, '#00f'))
    const rebased = mergeScenes(base, undoState, remote)
    const [a, b] = rebased.elements as (SceneElement & { fill: string })[]
    assert.equal(a.x, 10, 'lokalny stan historii zachowany')
    assert.equal(b.fill, '#00f', 'cudza zmiana nie znika po Cofnij')
  })
})
