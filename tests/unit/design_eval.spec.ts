import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { MockProvider } from '#services/ai/mock_provider'
import { invalidCssTokens, loadCases, runCase, scoreSpec } from '#services/design/eval'
import { validateDesignSpec } from '#services/design/spec'

test.group('Zestaw ewaluacyjny DESIGN.md', () => {
  test('przypadki się wczytują i przechodzą przez pipeline (dostawca mock)', async ({ assert }) => {
    const cases = await loadCases(app.makePath('tests/eval/cases'))
    assert.includeMembers(
      cases.map((c) => c.name),
      ['dark-chat', 'ziarno']
    )
    const result = await runCase(
      cases.find((c) => c.name === 'dark-chat')!,
      new MockProvider()
    )
    assert.isUndefined(result.error, result.error)
    assert.isAtLeast(result.score, 0)
    assert.lengthOf(result.invalidCss, 0)
  }).timeout(60_000)

  test('wszystkie przypadki (w tym nowe AI-12) przechodzą pipeline produkcyjny na mocku', async ({
    assert,
  }) => {
    const cases = await loadCases(app.makePath('tests/eval/cases'))
    assert.includeMembers(
      cases.map((c) => c.name),
      [
        'injection',
        'single-screenshot',
        'font-category',
        'inspiration-layout',
        'long-screenshot',
        'many-materials',
      ]
    )
    for (const c of cases) {
      const result = await runCase(c, new MockProvider())
      assert.isUndefined(result.error, `${c.name}: ${result.error}`)
      assert.lengthOf(result.invalidCss, 0, c.name)
    }
    // Inspiracja „tylko układ”: neonowe kolory nie trafiają do tokenów (rola materiału).
    const inspiration = await runCase(
      cases.find((c) => c.name === 'inspiration-layout')!,
      new MockProvider()
    )
    assert.notMatch(inspiration.violations.join(' '), /color #(ff00aa|39ff14|1b00ff)/)
  }).timeout(120_000)

  test('ocena wykrywa brakujące fakty i zmyślenia', ({ assert }) => {
    const spec = validateDesignSpec({
      name: 'Chat',
      overview: 'Each user has its own color.',
      colors: [
        { name: 'Bg', hex: '#0f0f0f', sources: [1] },
        { name: 'Alert', hex: '#ff4e45', sources: [1] },
      ],
      typography: { families: [{ name: 'Roboto', sources: [1] }] },
      components: [{ name: 'Row', description: 'x', sources: [1] }],
      voice: { examples: ['Czatzuj jako subskrybent…'] },
      dos: ['a'],
      donts: ['b'],
    })
    const c = {
      name: 'x',
      dir: '',
      boardTitle: 'x',
      notes: {},
      canvasNotes: [],
      usage: {},
      repeat: 1,
      expect: {
        forbiddenComponents: ['Modal'],
        fontsAssumed: true,
        forbiddenFonts: [],
        colors: ['#0f0f0f', '#aaaaaa'],
        fonts: ['Roboto'],
        text: ['Czatuj jako subskrybent'],
        forbiddenColors: ['#ff4e45'],
        forbiddenPhrases: ['Czatzuj', 'own color'],
      },
    }
    const s = scoreSpec(c, spec, `Each user has its own color. Czatzuj`)
    assert.deepEqual(s.colors.missing, ['#aaaaaa'])
    assert.deepEqual(s.text.missing, ['Czatuj jako subskrybent'])
    // Kolor alertu w tokenach, dwie frazy, Roboto podany jako fakt przy fontsAssumed.
    assert.lengthOf(s.violations, 4)
    assert.deepEqual(invalidCssTokens(spec), [])
  })
})
