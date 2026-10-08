import { test } from '@japa/runner'
import { validateDesignSpec } from '#services/design/spec'
import { diffDocs, type DocSnapshot } from '#services/design/spec_diff'

const spec = (extra: Record<string, unknown> = {}) =>
  validateDesignSpec({
    name: 'Cafe',
    overview: 'x [A1]',
    colors: [
      { name: 'Paper', hex: '#f6efe4', token: '--color-paper', sources: [1] },
      { name: 'Accent', hex: '#c0622d', token: '--color-accent', sources: [1] },
    ],
    typography: { families: [{ name: 'Inter', token: '--font-sans', sources: [1] }], scale: [] },
    components: [{ name: 'Button', description: 'b', sources: [1] }],
    screens: [{ name: 'Home', purpose: 'p', sources: [1] }],
    radii: [{ element: 'cards', value: '12px' }],
    dos: ['a'],
    donts: ['b'],
    ...extra,
  })

const snap = (
  version: number,
  s: ReturnType<typeof spec>,
  extra: Partial<DocSnapshot> = {}
): DocSnapshot => ({
  version,
  spec: s,
  sources: [{ assetId: 1, filename: 'home.png', kind: 'image', sections: [] }],
  promptVersion: 'v7',
  proMode: false,
  editedFromVersion: null,
  ...extra,
})

test.group('Zmiany między wersjami (FEAT-1)', () => {
  test('tokeny było → jest, dodane/usunięte, przyczyny z tablicy', ({ assert }) => {
    const before = snap(1, spec())
    const after = snap(
      2,
      spec({
        colors: [
          { name: 'Paper', hex: '#f6efe4', token: '--color-paper', sources: [1] },
          { name: 'Accent', hex: '#b5541f', token: '--color-accent', sources: [1] },
          { name: 'Moss', hex: '#5f7a5b', token: '--color-moss', sources: [2] },
        ],
        typography: {
          families: [{ name: 'Fraunces', token: '--font-sans', sources: [2] }],
          scale: [],
        },
        components: [{ name: 'Card', description: 'c', sources: [1] }],
        radii: [{ element: 'cards', value: '16px' }],
      }),
      {
        sources: [
          {
            assetId: 1,
            filename: 'home.png',
            kind: 'image',
            sections: [],
            usage: { role: 'own', aspects: [] },
          },
          {
            assetId: 2,
            filename: 'fonts.png',
            kind: 'image',
            sections: [],
            usage: { role: 'inspiration', aspects: ['typography'] },
          },
        ],
        proMode: true,
      }
    )
    const c = diffDocs(before, after)
    assert.deepEqual(c.colors.changed, [{ name: 'Accent', from: '#c0622d', to: '#b5541f' }])
    assert.deepEqual(c.colors.added, [{ name: 'Moss', value: '#5f7a5b' }])
    assert.deepEqual(c.fonts.changed, [{ name: '--font-sans', from: 'Inter', to: 'Fraunces' }])
    assert.deepEqual(c.radii.changed, [{ name: 'cards', from: '12px', to: '16px' }])
    assert.deepEqual(c.components, { added: ['Card'], removed: ['Button'] })
    assert.deepEqual(c.reasons.map((r) => r.type).sort(), [
      'asset_added',
      'pro_mode',
      'usage_changed',
    ])
    assert.isFalse(c.empty)
  })

  test('bez zmian w tokenach — pusty wynik', ({ assert }) => {
    const c = diffDocs(snap(1, spec()), snap(2, spec()))
    assert.isTrue(c.empty)
    assert.lengthOf(c.reasons, 0)
  })
})
