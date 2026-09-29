import { test } from '@japa/runner'
import { parseInline, parseMarkdown } from '#shared/markdown'
import { diffLines, diffStats } from '#shared/line-diff'

test.group('Markdown parser', () => {
  test('bloki DESIGN.md: nagłówki, cytat, listy, tabela, kod, akapit', ({ assert }) => {
    const blocks = parseMarkdown(
      [
        '# DESIGN.md — Kawa',
        '',
        '> linia 1',
        '> linia 2',
        '',
        '## 4. Tokeny',
        '',
        '| Token | Hex |',
        '| --- | --- |',
        '| primary | `#aa3300` |',
        '| pipe \\| w komórce | x |',
        '',
        '- a',
        '- b',
        '1. jeden',
        '',
        '```',
        '<script>alert(1)</script>',
        '```',
        'Zwykły',
        'akapit.',
        '---',
      ].join('\n')
    )

    assert.deepEqual(
      blocks.map((b) => b.type),
      ['heading', 'quote', 'heading', 'table', 'list', 'list', 'code', 'paragraph', 'rule']
    )
    const table = blocks[3] as Extract<(typeof blocks)[number], { type: 'table' }>
    assert.lengthOf(table.rows, 2)
    assert.deepEqual(table.rows[0][1], [{ type: 'code', text: '#aa3300' }])
    assert.deepEqual(table.rows[1][0], [{ type: 'text', text: 'pipe | w komórce' }])
    assert.equal((blocks[6] as any).text, '<script>alert(1)</script>')
    assert.deepEqual((blocks[7] as any).children, [{ type: 'text', text: 'Zwykły akapit.' }])
    assert.isFalse((blocks[4] as any).ordered)
    assert.isTrue((blocks[5] as any).ordered)
  })

  test('inline: pogrubienie, kursywa, kod, odwołania do assetów', ({ assert }) => {
    assert.deepEqual(parseInline('**Przycisk** [A12][A3] i *akcent* `code`'), [
      { type: 'strong', children: [{ type: 'text', text: 'Przycisk' }] },
      { type: 'text', text: ' ' },
      { type: 'assetRef', assetId: 12 },
      { type: 'assetRef', assetId: 3 },
      { type: 'text', text: ' i ' },
      { type: 'em', children: [{ type: 'text', text: 'akcent' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'code' },
    ])
  })

  test('linki tylko http(s) — javascript: zostaje tekstem', ({ assert }) => {
    assert.deepEqual(parseInline('[ok](https://x.dev)'), [
      { type: 'link', href: 'https://x.dev', children: [{ type: 'text', text: 'ok' }] },
    ])
    assert.deepEqual(parseInline('[zły](javascript:alert(1))'), [
      { type: 'text', text: 'zły' },
      { type: 'text', text: ')' },
    ])
  })

  test('snake_case w tekście nie staje się kursywą', ({ assert }) => {
    assert.deepEqual(parseInline('input_fingerprint'), [{ type: 'text', text: 'input_fingerprint' }])
  })
})

test.group('Line diff', () => {
  test('wykrywa dodane i usunięte linie, zachowuje wspólne', ({ assert }) => {
    const lines = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')
    assert.deepEqual(lines, [
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'same', text: 'd' },
      { type: 'added', text: 'e' },
    ])
    assert.deepEqual(diffStats(lines), { added: 2, removed: 1 })
  })

  test('identyczne teksty dają same linie wspólne', ({ assert }) => {
    assert.deepEqual(diffStats(diffLines('x\ny', 'x\ny')), { added: 0, removed: 0 })
  })
})

test.group('Markdown parser — listy', () => {
  test('pusta linia między pozycjami nie przerywa listy numerowanej', ({ assert }) => {
    const blocks = parseMarkdown('1. a\n\n2. b\n\n3. c\n\nakapit')
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['list', 'paragraph']
    )
    assert.lengthOf((blocks[0] as any).items, 3)
  })
})
