import { test } from '@japa/runner'
import {
  CLIPBOARD_SENTINEL,
  PASTE_OFFSET,
  parseClipboardElements,
  prepareElementsForPaste,
  serializeElements,
} from '#shared/clipboard'
import type { SceneElement } from '#shared/scene'

function rect(id: string, x = 0, y = 0): SceneElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    rotation: 0,
    opacity: 1,
    width: 100,
    height: 60,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 1,
  }
}

test.group('Schowek elementów sceny (clipboard)', () => {
  test('serialize + parse — round-trip bezstratny', ({ assert }) => {
    const elements = [rect('a', 1, 2), rect('b', 3, 4)]
    const text = serializeElements(elements)
    assert.isTrue(text.startsWith(CLIPBOARD_SENTINEL))
    assert.deepEqual(parseClipboardElements(text), elements)
  })

  test('parse — zwykły tekst to null (nie nasz payload)', ({ assert }) => {
    assert.isNull(parseClipboardElements('https://example.com'))
    assert.isNull(parseClipboardElements('zwykły tekst'))
    assert.isNull(parseClipboardElements(null))
    assert.isNull(parseClipboardElements(''))
  })

  test('parse — uszkodzony/obcy ładunek nie wywala, tylko null', ({ assert }) => {
    assert.isNull(parseClipboardElements(CLIPBOARD_SENTINEL + '{nie-json'))
    assert.isNull(parseClipboardElements(CLIPBOARD_SENTINEL + '{"x":1}'))
    assert.isNull(parseClipboardElements(CLIPBOARD_SENTINEL + '[]'))
    // element bez wymaganych pól (brak type/x/y)
    assert.isNull(parseClipboardElements(CLIPBOARD_SENTINEL + '[{"id":"a"}]'))
  })

  test('prepareElementsForPaste — nowe id i offset, oryginał nietknięty', ({ assert }) => {
    const original = rect('a', 10, 20)
    let n = 0
    const newId = () => `new-${++n}`
    const prepared = prepareElementsForPaste([original], newId)

    assert.lengthOf(prepared, 1)
    assert.equal(prepared[0].id, 'new-1')
    assert.equal(prepared[0].x, 10 + PASTE_OFFSET)
    assert.equal(prepared[0].y, 20 + PASTE_OFFSET)

    // oryginał nietknięty
    assert.equal(original.id, 'a')
    assert.equal(original.x, 10)
    assert.equal(original.y, 20)
  })
})
