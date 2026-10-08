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

const analysis = (extra: Record<string, unknown> = {}) => ({
  role: 'screen' as const,
  summary: 's',
  ocrText: '',
  palette: [],
  typography: [],
  components: [],
  layoutPatterns: [],
  styleHints: [],
  mood: '',
  tags: [],
  ...extra,
})

test.group('Fonty (AI-2)', () => {
  test('schemat: font bez „named” to przypuszczenie z kategorią', async ({ assert }) => {
    const { validateAssetAnalysis } = await import('#services/ai/schemas')
    const a = validateAssetAnalysis({
      summary: 's',
      typography: [
        { usage: 'H1', family: 'Inter', category: 'neo-grotesque sans', lineHeight: '1.2' },
        { usage: 'body', family: 'Fraunces', evidence: 'named' },
        { usage: 'caption', category: 'humanist sans-serif', evidence: 'named' },
      ],
      textColors: [
        { hex: '#333', usage: 'body text' },
        { hex: 'nope', usage: 'x' },
      ],
    })
    assert.equal(a.typography[0].evidence, 'inferred')
    assert.equal(a.typography[0].lineHeight, '1.2')
    assert.equal(a.typography[1].evidence, 'named')
    assert.equal(a.typography[2].evidence, 'inferred', 'bez nazwy nie ma „named”')
    assert.deepEqual(a.textColors, [{ hex: '#333333', usage: 'body text' }])
  })

  test('font nienazwany w materiałach staje się założeniem z pytaniem', ({ assert }) => {
    const s = spec({
      typography: {
        families: [
          { name: 'Inter', sources: [1] },
          { name: 'Fraunces', sources: [1] },
          { name: 'Space Grotesk', sources: [1] },
          { name: 'system-ui', sources: [1] },
        ],
        scale: [],
      },
    })
    const report = verifySpec(s, {
      assets: [
        {
          id: 1,
          analysis: analysis({
            typography: [
              {
                usage: 'H1',
                family: 'Inter',
                evidence: 'inferred',
                category: 'neo-grotesque sans',
              },
              { usage: 'body', family: 'Fraunces', evidence: 'named' },
            ],
          }),
        },
        { id: 2, analysis: analysis({ ocrText: 'Font: Space Grotesk 600' }) },
      ],
      notes: [],
    })
    const [inter, fraunces, grotesk, system] = s.typography.families
    assert.deepEqual(report.fontsFlagged, ['Inter'])
    assert.isTrue(inter.assumed)
    assert.deepEqual(inter.sources, [])
    assert.isFalse(fraunces.assumed)
    assert.deepEqual(grotesk.sources, [2], 'źródło poprawione na materiał z nazwą')
    assert.isFalse(system.assumed)
    assert.match(s.openQuestions.join(' '), /"Inter" is not named.*neo-grotesque sans/)
  })

  test('font wymieniony w notatce (np. style z Figmy) zostaje', ({ assert }) => {
    const s = spec({ typography: { families: [{ name: 'Manrope', sources: [1] }], scale: [] } })
    verifySpec(s, {
      assets: [{ id: 1, analysis: analysis() }],
      notes: ['Figma styles: Manrope 400/600'],
    })
    assert.isFalse(s.typography.families[0].assumed)
  })
})

test.group('Hexy w opisach (AI-4)', () => {
  test('hex spoza tabeli kolorów trafia do Open Questions', ({ assert }) => {
    const s = spec({
      colors: [{ name: 'Canvas', hex: '#0f0f0f', sources: [1] }],
      components: [
        { name: 'Btn', description: 'bg #0f0f0f text #fafafa border #123456', sources: [1] },
      ],
    })
    const report = verifySpec(s, {
      assets: [{ id: 1, analysis: analysis({ palette: [{ hex: '#0f0f0f' }] }) }],
      notes: [],
    })
    assert.sameMembers(report.strayHexes, ['#fafafa', '#123456'])
    assert.match(s.openQuestions.at(-1)!, /#fafafa \(Btn\)/)
  })
})
