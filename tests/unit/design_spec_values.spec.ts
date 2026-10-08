import { test } from '@japa/runner'
import {
  cssLength,
  cssShadow,
  validateDesignSpec,
  verifyColorEvidence,
} from '#services/design/spec'
import { renderCssVariables, renderDesignMd, renderTailwindTheme } from '#services/design/renderer'

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
      // Jedyne nawiasy w tokenach to funkcje CSS (np. krzywa ruchu), nie opisy.
      assert.notInclude(css.replace(/cubic-bezier\([^)]*\)/g, ''), '(')
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

  test('kolor z innego materiału — poprawione źródło; brak palet — niezweryfikowany', ({
    assert,
  }) => {
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

    // Źródło bez palety (link, PDF) nie potwierdza koloru: †, ale cytat zostaje (AI-4).
    const noPalette = validateDesignSpec(minimalSpec())
    assert.deepEqual(verifyColorEvidence(noPalette, new Map([[1, []]])), ['Ink', 'Alert Red'])
    assert.isTrue(noPalette.colors[0].assumed)
    assert.deepEqual(noPalette.colors[0].sources, [1])
  })

  test('progi AI-4: bliski kolor przyciągany do hexa z materiału, sąsiednie szarości osobno', ({
    assert,
  }) => {
    const spec = validateDesignSpec(
      minimalSpec({
        colors: [
          { name: 'Red', hex: '#dc2626', sources: [1] },
          { name: 'Gray', hex: '#777777', sources: [1] },
          { name: 'Tailwind Red', hex: '#ef4444', sources: [1] },
        ],
        components: [{ name: 'Btn', description: 'bg #dc2626, border #777', sources: [1] }],
      })
    )
    const flagged = verifyColorEvidence(spec, new Map([[1, ['#d93025', '#6e6e6e']]]))
    assert.equal(spec.colors[0].hex, '#d93025', 'przyciągnięty do obserwowanego')
    assert.include(spec.components[0].description, 'bg #d93025')
    assert.sameMembers(flagged, ['Gray', 'Tailwind Red'])
    assert.equal(spec.colors[0].token, '--color-red')
  })
})

test.group('DesignSpec — nazwy tokenów i system (AI-9)', () => {
  test('odstępy semantyczne, Tailwind nie nadpisuje skali liczbowej, jedna interlinia', ({
    assert,
  }) => {
    const spec = validateDesignSpec(
      minimalSpec({
        spacing: {
          baseUnit: '4px',
          scale: ['32', '4', '16', '8', '24', '12', '48'].map((n) => ({
            name: n,
            value: `${n}px`,
          })),
        },
        typography: {
          families: [{ name: 'Roboto', sources: [1] }],
          scale: [
            { role: 'body', size: '14px', lineHeight: '1.5', token: '--text-body' },
            { role: 'body', size: '16px', lineHeight: '1.5', token: '--text-body' },
          ],
        },
        radii: [
          { element: 'cards', value: '12px' },
          { element: 'Cards', value: '16px' },
        ],
      })
    )
    assert.deepEqual(
      spec.spacing.scale.map((s) => `${s.name}=${s.value}`),
      ['2xs=4px', 'xs=8px', 'sm=12px', 'md=16px', 'lg=24px', 'xl=32px', '2xl=48px']
    )
    assert.deepEqual(spec.radii, [{ name: 'cards', value: '12px' }])
    assert.deepEqual(
      spec.typography.scale.map((r) => r.token),
      ['--text-body', '--text-body-2']
    )
    const tw = renderTailwindTheme(spec)
    assert.notMatch(tw, /--spacing-\d+:/)
    assert.include(tw, '--spacing: 4px;')
    assert.include(tw, '--text-body--line-height: 1.5;')
    const css = renderCssVariables(spec)
    assert.include(css, '--text-body--line-height: 1.5;')
    assert.notInclude(css, '--leading-')
  })

  test('brakujące breakpointy, warstwy, ruch i focus — wartości domyślne jako założenia', ({
    assert,
  }) => {
    const spec = validateDesignSpec(
      minimalSpec({
        colors: [{ name: 'Primary', hex: '#3355ff', role: 'primary action', sources: [1] }],
        breakpoints: [{ name: 'tablet', value: '800px' }],
        motion: [
          { name: 'quick', value: '90ms' },
          { name: 'wobbly', value: 'bouncy' },
        ],
      })
    )
    assert.deepEqual(spec.breakpoints, [{ name: 'tablet', value: '800px' }])
    assert.equal(spec.focusRing, '2px solid #3355ff')
    assert.sameMembers(spec.systemAssumed!, ['z-index layers', 'border widths', 'focus ring'])
    assert.match(spec.openQuestions.join(' '), /motion „wobbly”/)
    const css = renderCssVariables(spec)
    assert.include(css, '--breakpoint-tablet: 800px;')
    assert.include(css, '--z-modal: 50;')
    assert.include(css, '--duration-quick: 90ms;')
    assert.include(css, '--focus-ring: 2px solid #3355ff;')
    const { markdown } = renderDesignMd(spec, [], {
      boardTitle: 'B',
      version: 1,
      generatedAt: 'now',
    })
    assert.include(markdown, '## Tokens — Responsive, Layers & Motion')
    assert.match(markdown, /z-index layers \(typical defaults/)
  })
})
