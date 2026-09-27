import { test } from '@japa/runner'
import {
  addElement,
  commitHistory,
  createElementId,
  duplicateElements,
  HISTORY_LIMIT,
  moveElements,
  redoHistory,
  removeElements,
  reorderElement,
  undoHistory,
  updateElement,
  type SceneHistoryState,
} from '#shared/scene-ops'
import { emptySceneDocument, type SceneDocument, type SceneElement } from '#shared/scene'
import { sceneFixture } from '#shared/scene.fixture'

function rect(id: string, x = 0, y = 0): SceneElement {
  return { id, type: 'rectangle', x, y, rotation: 0, opacity: 1, width: 100, height: 60, fill: '#fff', stroke: '#000', strokeWidth: 1 }
}

function initialState(doc: SceneDocument): SceneHistoryState {
  return { document: doc, past: [], future: [] }
}

test.group('SceneDocument reducer (scene-ops)', () => {
  test('addElement dodaje na wierzch (koniec tablicy)', ({ assert }) => {
    const doc = emptySceneDocument()
    const next = addElement(doc, rect('a'))
    assert.lengthOf(next.elements, 1)
    assert.equal(next.elements[0].id, 'a')
    // Nie mutuje wejścia.
    assert.lengthOf(doc.elements, 0)
  })

  test('removeElements usuwa tylko wybrane', ({ assert }) => {
    let doc = addElement(emptySceneDocument(), rect('a'))
    doc = addElement(doc, rect('b'))
    doc = addElement(doc, rect('c'))
    const next = removeElements(doc, ['a', 'c'])
    assert.deepEqual(next.elements.map((e) => e.id), ['b'])
  })

  test('moveElements przesuwa tylko wybrane', ({ assert }) => {
    let doc = addElement(emptySceneDocument(), rect('a', 0, 0))
    doc = addElement(doc, rect('b', 10, 20))
    const next = moveElements(doc, ['a'], 5, -3)
    assert.equal(next.elements[0].x, 5)
    assert.equal(next.elements[0].y, -3)
    assert.equal(next.elements[1].x, 10)
  })

  test('duplicateElements tworzy nowe id i offset', ({ assert }) => {
    const doc = addElement(emptySceneDocument(), rect('a', 10, 10))
    const next = duplicateElements(doc, ['a'])
    assert.lengthOf(next.elements, 2)
    const clone = next.elements[1]
    assert.notEqual(clone.id, 'a')
    assert.equal(clone.x, 20)
    assert.equal(clone.y, 20)
  })

  test('reorderElement przesuwa warstwę w obie strony', ({ assert }) => {
    let doc = addElement(emptySceneDocument(), rect('a'))
    doc = addElement(doc, rect('b'))
    doc = addElement(doc, rect('c'))

    const up = reorderElement(doc, 'a', 'forward')
    assert.deepEqual(up.elements.map((e) => e.id), ['b', 'a', 'c'])

    const down = reorderElement(doc, 'c', 'backward')
    assert.deepEqual(down.elements.map((e) => e.id), ['a', 'c', 'b'])

    // Skrajne przypadki nie zmieniają kolejności.
    const top = reorderElement(doc, 'c', 'forward')
    assert.deepEqual(top.elements.map((e) => e.id), ['a', 'b', 'c'])
  })

  test('updateElement mergeuje pola', ({ assert }) => {
    const doc = addElement(emptySceneDocument(), rect('a', 0, 0))
    const next = updateElement(doc, 'a', { x: 42 })
    assert.equal(next.elements[0].x, 42)
    const shape = next.elements[0] as Extract<SceneElement, { width: number }>
    assert.equal(shape.width, 100)
  })

  test('undo/redo cofa i ponawia krok', ({ assert }) => {
    let state = initialState(emptySceneDocument())
    state = commitHistory(state, addElement(state.document, rect('a')))
    state = commitHistory(state, addElement(state.document, rect('b')))
    assert.lengthOf(state.document.elements, 2)

    const undone = undoHistory(state)
    assert.deepEqual(undone.document.elements.map((e) => e.id), ['a'])
    assert.lengthOf(undone.future, 1)

    const redone = redoHistory(undone)
    assert.deepEqual(redone.document.elements.map((e) => e.id), ['a', 'b'])
    assert.lengthOf(redone.future, 0)
  })

  test('undo na pustej historii zwraca niezmieniony stan', ({ assert }) => {
    const state = initialState(addElement(emptySceneDocument(), rect('a')))
    const result = undoHistory(state)
    assert.deepEqual(result, state)
  })

  test('commit czyści future (nowa gałąź)', ({ assert }) => {
    let state = initialState(emptySceneDocument())
    state = commitHistory(state, addElement(state.document, rect('a')))
    state = commitHistory(state, addElement(state.document, rect('b')))
    state = undoHistory(state) // cofnij do ['a'], future = [['a','b']]
    state = commitHistory(state, addElement(state.document, rect('c'))) // nowa gałąź
    assert.deepEqual(state.document.elements.map((e) => e.id), ['a', 'c'])
    assert.lengthOf(state.future, 0)
  })

  test('serializacja round-trip jest bezstratna', ({ assert }) => {
    let doc = emptySceneDocument()
    doc = addElement(doc, rect('a', 1.5, -2.25))
    doc = addElement(doc, {
      id: 'img',
      type: 'image',
      x: 3,
      y: 4,
      rotation: 45,
      opacity: 0.5,
      assetId: 'asset-1',
      width: 320,
      height: 200,
    })
    const round = JSON.parse(JSON.stringify(doc))
    assert.deepEqual(round, doc)
    assert.deepEqual(JSON.parse(JSON.stringify(round)), round)
  })

  test('createElementId zwraca unikalne identyfikatory', ({ assert }) => {
    const a = createElementId()
    const b = createElementId()
    assert.notEqual(a, b)
    assert.isString(a)
  })

  /**
   * Inwariant historii wymagany przez Bramkę 2 (BLA-11, punkt 6):
   * 20 mieszanych operacji -> 20x undo -> scena IDENTYCZNA z początkową
   * (porównanie głębokie), -> 20x redo -> scena identyczna ze stanem po 20 operacjach.
   */
  test('inwariant undo/redo na serii 20 mieszanych operacji', ({ assert }) => {
    // Scena startowa: pełny fixture kontraktu (po jednym elemencie każdego typu).
    const initial = structuredClone(sceneFixture) as SceneDocument
    const initialSnapshot = structuredClone(initial)

    let state = initialState(initial)
    const ids = initial.elements.map((e) => e.id)

    // 20 operacji, każda z 6 kategorii wymaganych przez bramkę:
    // add, remove, move, reorder (warstwa), update (edycja pola), duplicate.
    const operations: Array<(doc: SceneDocument) => SceneDocument> = [
      (d) => addElement(d, rect('op-add-1', 900, 10)), // 1 add
      (d) => moveElements(d, [ids[0]], 5, 7), // 2 move
      (d) => updateElement(d, ids[5], { opacity: 0.5 }), // 3 update
      (d) => reorderElement(d, ids[1], 'forward'), // 4 reorder
      (d) => duplicateElements(d, [ids[2]]), // 5 duplicate
      (d) => removeElements(d, [ids[3]]), // 6 remove
      (d) => addElement(d, rect('op-add-2', 900, 80)), // 7 add
      (d) => moveElements(d, [ids[4], ids[6]], -12, 3), // 8 move (wiele)
      (d) => updateElement(d, ids[6], { rotation: 15 }), // 9 update
      (d) => reorderElement(d, ids[7], 'backward'), // 10 reorder
      (d) => duplicateElements(d, ['op-add-1']), // 11 duplicate
      (d) => removeElements(d, [ids[2]]), // 12 remove
      (d) => addElement(d, rect('op-add-3', 900, 150)), // 13 add
      (d) => moveElements(d, ['op-add-2'], 1.5, -2.25), // 14 move (ułamki)
      (d) => updateElement(d, ids[0], { x: 1234, opacity: 0.25 }), // 15 update (wiele pól)
      (d) => reorderElement(d, 'op-add-3', 'backward'), // 16 reorder
      (d) => duplicateElements(d, [ids[5], ids[6]]), // 17 duplicate (wiele)
      (d) => removeElements(d, ['op-add-2']), // 18 remove
      (d) => moveElements(d, ['op-add-3'], 40, 40), // 19 move
      (d) => updateElement(d, ids[7], { width: 640, height: 400 }), // 20 update
    ]
    assert.lengthOf(operations, 20)

    for (const apply of operations) {
      state = commitHistory(state, apply(state.document))
    }

    const afterAll = structuredClone(state.document)
    // Sanity: seria faktycznie zmieniła scenę (inaczej test nic nie dowodzi).
    assert.notDeepEqual(afterAll, initialSnapshot)
    assert.lengthOf(state.past, 20)
    // 20 kroków mieści się w limicie historii — nic nie zostało przycięte.
    assert.isBelow(20, HISTORY_LIMIT)

    for (let i = 0; i < 20; i++) state = undoHistory(state)

    assert.lengthOf(state.past, 0)
    assert.lengthOf(state.future, 20)
    // Porównanie GŁĘBOKIE całego dokumentu, nie długości tablicy.
    assert.deepEqual(state.document, initialSnapshot)

    for (let i = 0; i < 20; i++) state = redoHistory(state)

    assert.lengthOf(state.past, 20)
    assert.lengthOf(state.future, 0)
    assert.deepEqual(state.document, afterAll)

    // Wejściowy dokument nie został zmutowany po drodze.
    assert.deepEqual(initial, initialSnapshot)
  })
})
