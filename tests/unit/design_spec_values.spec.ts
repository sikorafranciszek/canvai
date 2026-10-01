import { test } from '@japa/runner'
import {
  cssLength,
  cssShadow,
  validateDesignSpec,
  verifyColorEvidence,
} from '#services/design/spec'
import { renderCssVariables, renderTailwindTheme } from '#services/design/renderer'

function minimalSpec(extra: Record<string, unknown> = {}) {
  return {
    name: 'Chat',
    overview: 'Dark chat [A1]',
    colors: [
      { name: 'Ink', hex: '#0f0f0f', role: 'bg', sources: [1] },
      { name: 'Alert Red', hex: '#ff4e45', role: 'error', sources: [1] },
    ],
    typography: { families: [{ name: 'Roboto', sources: [1] }], scale: [] },
    components: [{ name: 'Row', description: 'Message row', sources: [1] }],
    dos: ['Keep it dense'],
    donts: ['No bubbles'],
    ...extra,
  }
}

test.group('DesignSpec — wartości CSS', () => {
  test('cssLength usuwa opisy i odrzuca słowa', ({ assert }) => {
    assert.equal(cssLength('50% (24px circle)'), '50%')
    assert.equal(cssLength('~8px'), '8px')
    assert.equal(cssLength('8'), '8px')
    assert.equal(cssLength('8px 12px'), '8px 12px')
    assert.equal(cssLength('1.43', { unitless: true }), '1.43')
    assert.equal(cssLength('pill'), '9999px')
    assert.equal(cssLength('fully circular'), '50%')
    assert.equal(cssLength('12px on cards, 8px on inputs'), '12px')
    assert.isNull(cssLength('medium'))
  })

  test('cssShadow przepuszcza box-shadow, odrzuca opisy', ({ assert }) => {
    assert.equal(
      cssShadow('rgba(0, 0, 0, 0.08) 0px 1px 2px 0px (subtle)'),
      'rgba(0, 0, 0, 0.08) 0px 1px 2px 0px'
    )
    assert.equal(cssShadow('none'), 'none')
    assert.isNull(cssShadow('soft shadow under cards'))
  })

  test('niepoprawne wartości nie trafiają do :root/@theme, tylko do pytań', ({ assert }) => {
    const spec = validateDesignSpec(
      minimalSpec({
        radii: [
          { element: 'avatars', value: '50% (24px circle)' },
          { element: 'cards', value: 'slightly rounded' },
        ],
        shadows: [{ name: 'card', value: 'soft and diffuse' }],
      })
    )
    assert.deepEqual(spec.radii, [{ name: 'avatars', value: '50%' }])
    assert.lengthOf(spec.shadows, 0)
    for (const css of [renderCssVariables(spec), renderTailwindTheme(spec)]) {
      assert.include(css, '--radius-avatars: 50%;')
      assert.notInclude(css, '(')
    }
    assert.match(spec.openQuestions.join(' '), /radius „cards”: „slightly rounded”/)
  })
})

test.group('DesignSpec — kolory a materiały', () => {
  test('kolor spoza palet materiałów staje się założeniem', ({ assert }) => {
    const spec = validateDesignSpec(minimalSpec())
    const flagged = verifyColorEvidence(spec, new Map([[1, ['#101010', '#ffffff']]]))
    assert.deepEqual(flagged, ['Alert Red'])
    assert.isFalse(spec.colors[0].assumed, 'bliski odcień z palety zostaje faktem')
    assert.isTrue(spec.colors[1].assumed)
    assert.deepEqual(spec.colors[1].sources, [])
  })

  test('kolor z innego materiału — poprawione źródło; brak palet — bez zmian', ({ assert }) => {
    const spec = validateDesignSpec(minimalSpec())
    verifyColorEvidence(
      spec,
      new Map([
        [1, ['#0f0f0f']],
        [2, ['#ff4e45']],
      ])
    )
    assert.deepEqual(spec.colors[1].sources, [2])
    assert.isFalse(spec.colors[1].assumed)

    const noPalette = validateDesignSpec(minimalSpec())
    assert.deepEqual(verifyColorEvidence(noPalette, new Map([[1, []]])), [])
  })
})
