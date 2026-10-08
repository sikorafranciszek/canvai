import { test } from '@japa/runner'
import { allowsAspect, describeUsage, normalizeUsage, usageGuideLine } from '#shared/asset-usage'
import { enforceUsage, validateDesignSpec } from '#services/design/spec'
import { renderDesignMd } from '#services/design/renderer'
import { buildComposeUserText } from '#services/design/prompts'
import { buildBoardContext } from '#services/design/board_context'

const spec = () =>
  validateDesignSpec({
    name: 'Mix',
    overview: 'x [A1]',
    colors: [
      { name: 'Ink', hex: '#111111', sources: [1, 2] },
      { name: 'Accent', hex: '#c0622d', sources: [2] },
    ],
    typography: {
      families: [
        { name: 'Fraunces', sources: [2] },
        { name: 'Inter', sources: [3] },
      ],
    },
    components: [{ name: 'Card', description: 'c', sources: [3] }],
    dos: ['a'],
    donts: ['b'],
  })

test.group('Rola i aspekty materiałów', () => {
  test('dozwolone aspekty i opisy', ({ assert }) => {
    const typo = normalizeUsage('inspiration', ['typography', 'nonsense'])
    assert.deepEqual(typo.aspects, ['typography'])
    assert.isTrue(allowsAspect(typo, 'typography'))
    assert.isFalse(allowsAspect(typo, 'colors'))
    assert.isTrue(allowsAspect(normalizeUsage(null, []), 'colors'))
    assert.isFalse(allowsAspect(normalizeUsage('avoid', []), 'layout'))
    assert.equal(describeUsage(typo), 'inspiration — typography only')
    assert.match(usageGuideLine(typo)!, /take typography; ignore its colors, layout/)
  })

  test('kod zdejmuje źródła niezgodne z aspektami (kolor tylko z inspiracji „typografia” → usunięty)', ({
    assert,
  }) => {
    const s = spec()
    const usages = new Map([
      [1, normalizeUsage('own', [])],
      [2, normalizeUsage('inspiration', ['typography'])],
      [3, normalizeUsage('avoid', [])],
    ])
    const stripped = enforceUsage(s, usages)
    assert.deepEqual(s.colors[0].sources, [1])
    assert.isFalse(s.colors[0].assumed)
    assert.deepEqual(
      s.colors.map((c) => c.name),
      ['Ink'],
      'akcent tylko z referencji typografii nie trafia do tokenów (AI-4)'
    )
    assert.deepEqual(s.typography.families[0].sources, [2], 'font z referencji typografii zostaje')
    assert.isTrue(s.typography.families[1].assumed, 'nic z anty-wzoru')
    assert.isTrue(s.components[0].assumed)
    assert.isAbove(stripped.length, 0)
  })

  test('DESIGN.md: przewodnik po referencjach i kolumna roli; prompt dostaje „use”', ({
    assert,
  }) => {
    const assets = [
      {
        id: 1,
        filename: 'home.png',
        kind: 'image',
        userNote: null,
        usage: normalizeUsage('own', []),
      },
      {
        id: 2,
        filename: 'fonts.png',
        kind: 'image',
        userNote: 'ta czcionka',
        usage: normalizeUsage('inspiration', ['typography']),
      },
    ]
    const { markdown } = renderDesignMd(spec(), assets, {
      boardTitle: 'B',
      version: 1,
      generatedAt: 'now',
    })
    assert.include(markdown, '## How to Use the References')
    assert.include(markdown, '[A2] fonts.png — inspiration: take typography; ignore its colors')
    assert.include(markdown, '| A2 | fonts.png | image | inspiration — typography only |')

    const text = buildComposeUserText({
      boardTitle: 'B',
      context: buildBoardContext(null),
      assets: assets.map((a) => ({
        ...a,
        onCanvas: true,
        analysis: {
          role: 'screen',
          summary: 's',
          ocrText: '',
          palette: [],
          typography: [],
          components: [],
          layoutPatterns: [],
          styleHints: [],
          mood: '',
          tags: [],
        } as any,
      })),
    })
    assert.include(text, '"role": "inspiration"')
    assert.include(text, '"typography"')
  })
})
