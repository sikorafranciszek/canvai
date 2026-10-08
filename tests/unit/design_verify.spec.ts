import { test } from '@japa/runner'
import { validateDesignSpec } from '#services/design/spec'
import {
  filterSimilarBrands,
  isProposed,
  stripProposed,
  verifyMicrocopy,
  verifySpec,
} from '#services/design/verify'
import { renderDesignMd } from '#services/design/renderer'

function spec(extra: Record<string, unknown> = {}) {
  return validateDesignSpec({
    name: 'Czatzuj',
    overview: 'Chat app [A1]',
    colors: [{ name: 'Canvas', hex: '#0f0f0f', sources: [1] }],
    typography: { families: [{ name: 'Roboto', sources: [1] }], scale: [] },
    components: [{ name: 'Input', description: 'Composer', sources: [1] }],
    dos: ['Keep it dense'],
    donts: ['No bubbles'],
    ...extra,
  })
}

test.group('Weryfikacja mikrocopy (AI-3)', () => {
  test('rozpoznaje warianty oznaczenia propozycji', ({ assert }) => {
    for (const e of [
      'Proposed: Send',
      'proposed – Send',
      'Proposed — Send',
      '(Proposed) Send',
      '[proposed] Send',
      'Send (proposed)',
      'Proposed "Send"',
    ]) {
      assert.isTrue(isProposed(e), e)
      assert.equal(stripProposed(e), 'Send', e)
    }
    assert.isFalse(isProposed('Proposed changes'))
    assert.isFalse(isProposed('Send'))
  })

  test('cytat bez pokrycia w OCR/notatkach staje się propozycją', ({ assert }) => {
    const s = spec({
      voice: {
        tone: 'casual',
        examples: [
          'Napisz wiadomość…',
          '„Czatzuj ze znajomymi!”',
          'Wiadomość została usunięta',
          '(Proposed) Spróbuj ponownie',
        ],
      },
    })
    const flagged = verifyMicrocopy(s, ['NAPISZ  wiadomość', 'Czatzuj ze znajomymi'])
    assert.deepEqual(flagged, ['Wiadomość została usunięta'])
    assert.deepEqual(s.voice.examples, [
      'Napisz wiadomość…',
      'Czatzuj ze znajomymi!',
      'Proposed: Wiadomość została usunięta',
      'Proposed: Spróbuj ponownie',
    ])
    const { markdown } = renderDesignMd(s, [], { boardTitle: 'B', version: 1, generatedAt: 'now' })
    assert.include(markdown, '„Wiadomość została usunięta” _(proposed)_')
    assert.include(markdown, '„Czatzuj ze znajomymi!”\n')
  })

  test('teksty z materiału bez aspektu „copy” nie potwierdzają cytatu', ({ assert }) => {
    const s = spec({ voice: { tone: '', examples: ['Buy now'] } })
    const analysis = {
      role: 'screen' as const,
      summary: 's',
      ocrText: 'Buy now',
      palette: [],
      typography: [],
      components: [],
      layoutPatterns: [],
      styleHints: [],
      mood: '',
      tags: [],
    }
    const report = verifySpec(s, {
      assets: [{ id: 1, usage: { role: 'inspiration', aspects: ['layout'] }, analysis }],
      notes: [],
    })
    assert.deepEqual(report.microcopyProposed, ['Buy now'])
  })
})

test.group('Podobne marki (AI-1)', () => {
  test('zostają tylko marki wymienione przez klienta', ({ assert }) => {
    const s = spec({
      similarBrands: [
        { name: 'Linear', reason: 'dense' },
        { name: 'Slack', reason: 'chat' },
        { name: 'X', reason: 'too short' },
      ],
    })
    const removed = filterSimilarBrands(s, ['Chcemy klimat jak w Linear, ale cieplej.'])
    assert.deepEqual(
      s.similarBrands.map((b) => b.name),
      ['Linear']
    )
    assert.sameMembers(removed, ['Slack', 'X'])
  })
})
