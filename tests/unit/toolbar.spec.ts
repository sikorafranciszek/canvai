import { test } from '@japa/runner'
import { TOOLS, VIEW_TOOLS, toolForKey, toolTestId, type Tool } from '#shared/tools'

test.group('Toolbar (pasek narzędzi)', () => {
  test('definiuje wszystkie narzędzia silnika', ({ assert }) => {
    const ids = TOOLS.map((t) => t.id)
    const expected: Tool[] = [
      'select',
      'pan',
      'rectangle',
      'ellipse',
      'line',
      'arrow',
      'freehand',
      'text',
      'sticky',
    ]
    for (const e of expected) {
      assert.isTrue(ids.includes(e), `brakuje narzędzia ${e}`)
    }
  })

  test('każde narzędzie ma unikalne data-testid (tool-<id>)', ({ assert }) => {
    const testIds = TOOLS.map((t) => toolTestId(t.id))
    assert.equal(new Set(testIds).size, testIds.length)
    assert.isTrue(testIds.includes('tool-select'))
    assert.isTrue(testIds.includes('tool-freehand'))
    assert.isTrue(testIds.includes('tool-sticky'))
  })

  test('każde narzędzie ma niepustą etykietę', ({ assert }) => {
    for (const t of TOOLS) {
      assert.isTrue(t.label.length > 0, `narzędzie ${t.id} bez etykiety`)
    }
  })

  test('skróty klawiszowe wybierają narzędzia (UX-1)', ({ assert }) => {
    assert.equal(toolForKey('v'), 'select')
    assert.equal(toolForKey('R'), 'rectangle')
    assert.equal(toolForKey('o'), 'ellipse')
    assert.equal(toolForKey('l'), 'line')
    assert.equal(toolForKey('a'), 'arrow')
    assert.equal(toolForKey('p'), 'freehand')
    assert.equal(toolForKey('t'), 'text')
    assert.equal(toolForKey('s'), 'sticky')
    assert.equal(toolForKey('h'), 'pan')
    assert.isNull(toolForKey('x'))
    assert.isNull(toolForKey('Enter'))
    const keys = TOOLS.flatMap((t) => (t.shortcut ? [t.shortcut] : []))
    assert.equal(new Set(keys).size, keys.length, 'skróty muszą być unikalne')
    assert.sameMembers(VIEW_TOOLS, ['select', 'pan'])
  })
})
