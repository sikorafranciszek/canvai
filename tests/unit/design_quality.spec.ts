import { test } from '@japa/runner'
import { contrastRatio, fixContrast, wcagLevel } from '#shared/color'
import { assessQuality, contrastChecks } from '#services/design/quality'
import { applySpecEdits } from '#services/design/edit'
import { validateDesignSpec } from '#services/design/spec'
import { renderDesignMd } from '#services/design/renderer'

function spec(extra: Record<string, unknown> = {}) {
  return validateDesignSpec({
    name: 'Chat',
    theme: 'dark',
    overview: 'Dark chat [A1]',
    colors: [
      {
        name: 'Canvas',
        hex: '#0f0f0f',
        token: '--color-background',
        role: 'page background',
        sources: [1],
      },
      {
        name: 'Primary Text',
        hex: '#ffffff',
        token: '--color-text',
        role: 'messages',
        sources: [1],
      },
      {
        name: 'Muted Text',
        hex: '#444444',
        token: '--color-text-muted',
        role: 'timestamps',
        sources: [1],
      },
      { name: 'Alert', hex: '#ff4e45', role: 'error', sources: [], assumed: true },
    ],
    typography: { families: [{ name: 'Roboto', sources: [1] }], scale: [] },
    components: [
      {
        name: 'Input',
        description: 'Composer #ffffff text',
        states: ['focus: ring'],
        sources: [1],
      },
    ],
    dos: ['Keep it dense'],
    donts: ['No bubbles'],
    ...extra,
  })
}

test.group('Kolory i WCAG', () => {
  test('kontrast i poziomy WCAG', ({ assert }) => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
    assert.equal(wcagLevel(4.6), 'AA')
    assert.equal(wcagLevel(3.2), 'AA-large')
    assert.equal(wcagLevel(2), 'fail')
  })

  test('fixContrast zwraca najbliższy odcień spełniający 4.5:1', ({ assert }) => {
    const fixed = fixContrast('#444444', '#0f0f0f')!
    assert.isAtLeast(contrastRatio(fixed, '#0f0f0f'), 4.5)
    assert.isBelow(contrastRatio(fixed, '#0f0f0f'), 5.2, 'możliwie blisko progu')
    const onLight = fixContrast('#7fb3ff', '#ffffff')!
    assert.isAtLeast(contrastRatio(onLight, '#ffffff'), 4.5)
  })
})

test.group('Ocena jakości DESIGN.md', () => {
  test('wykrywa słaby kontrast, luki i założenia', ({ assert }) => {
    const report = assessQuality(spec(), 1)
    const muted = contrastChecks(spec()).find((c) => c.text.name === 'Muted Text')!
    assert.equal(muted.level, 'fail')
    assert.isAtLeast(contrastRatio(muted.suggestion!, '#0f0f0f'), 4.5)
    const ids = report.gaps.map((g) => g.id)
    assert.includeMembers(ids, [
      'contrast',
      'few_materials',
      'no_success_color',
      'small_type_scale',
    ])
    assert.notInclude(ids, 'no_error_color')
    assert.notInclude(ids, 'no_focus_state')
    assert.deepEqual(report.assumed, [{ kind: 'color', name: 'Alert' }])
    assert.isBelow(report.score, 85)
    assert.equal(report.gaps[0].severity, 'high')
  })

  test('DESIGN.md ma sekcję Accessibility z sugestią', ({ assert }) => {
    const { markdown } = renderDesignMd(spec(), [], {
      boardTitle: 'B',
      version: 1,
      generatedAt: 'now',
    })
    assert.include(markdown, '## Accessibility')
    assert.match(
      markdown,
      /Muted Text `#444444` \| Canvas `#0f0f0f` \| [\d.]+:1 \| ⚠ fail \| `#[0-9a-f]{6}`/
    )
  })

  test('edycja: kolor podmieniony wszędzie, potwierdzenie zdejmuje założenie', ({ assert }) => {
    const { spec: edited, changes } = applySpecEdits(spec(), {
      colors: [
        { token: '--color-text', hex: '#fafafa' },
        { token: '--color-alert', confirm: true },
      ],
    })
    assert.isAbove(changes, 0)
    assert.equal(edited.colors[1].hex, '#fafafa')
    assert.include(edited.components[0].description, '#fafafa')
    assert.isFalse(edited.colors[3].assumed)
    assert.isTrue(edited.colors[3].confirmed)
    const { markdown } = renderDesignMd(edited, [], {
      boardTitle: 'B',
      version: 2,
      generatedAt: 'now',
    })
    assert.include(markdown, 'confirmed by client')
    assert.notInclude(markdown, 'color „Alert”')
  })
})

test.group('Eksporty dla narzędzi', () => {
  test('Tailwind v3, SCSS, Tokens Studio, reguły Cursora, CLAUDE.md i prompt', async ({
    assert,
  }) => {
    const { renderExport, EXPORT_FORMATS } = await import('#services/design/exports')
    const s = spec({ radii: [{ element: 'cards', value: '12px' }] })
    for (const format of EXPORT_FORMATS) {
      const file = renderExport(s, format)
      assert.isAbove(file.body.length, 50, format)
    }
    const tw = renderExport(s, 'tailwind3').body
    assert.include(tw, 'module.exports')
    assert.include(tw, '"text-muted": "#444444"')
    assert.include(tw, '"cards": "12px"')
    assert.include(renderExport(s, 'scss').body, '$color-background: #0f0f0f;')
    const studio = JSON.parse(renderExport(s, 'figma').body)
    assert.equal(studio.chat.color.canvas.value, '#0f0f0f')
    assert.equal(studio.chat.borderRadius.cards.type, 'borderRadius')
    const cursor = renderExport(s, 'cursor').body
    assert.match(cursor, /^---\ndescription: Chat design system/)
    assert.include(cursor, '`--color-text` #ffffff')
    assert.include(renderExport(s, 'claude').body, '@DESIGN.md')
    assert.notInclude(renderExport(s, 'prompt').body, '[A1]')
  })
})
