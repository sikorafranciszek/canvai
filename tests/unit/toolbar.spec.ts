import { test } from '@japa/runner'
import { TOOLS, toolTestId, type Tool } from '#shared/tools'

test.group('Toolbar (pasek narzędzi)', () => {
  test('definiuje wszystkie narzędzia silnika', ({ assert }) => {
    const ids = TOOLS.map((t) => t.id)
    const expected: Tool[] = ['select', 'pan', 'rectangle', 'ellipse', 'line', 'arrow', 'freehand', 'text', 'sticky']
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
})
