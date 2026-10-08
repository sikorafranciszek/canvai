import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace design:eval` — zestaw ewaluacyjny DESIGN.md (tests/eval/cases).
 *
 *   --case=dark-chat        tylko jeden przypadek
 *   --save-baseline         zapisz wynik jako punkt odniesienia (tests/eval/baseline.json)
 *   --max-drop=5            błąd (exit 1), gdy wynik przypadku spadnie o więcej punktów
 *   --runs=3                każdy przypadek kilka razy — średnia i odchylenie (model nie jest deterministyczny)
 *
 * Używa aktywnego dostawcy (AI_PROVIDER) — z `deepseek` to prawdziwe wywołania
 * modelu (koszt!). Uruchamiaj przed każdą zmianą promptu i porównuj z baseline.
 */
export default class DesignEval extends BaseCommand {
  static commandName = 'design:eval'
  static description = 'Ocena jakości DESIGN.md na zestawie przypadków testowych'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Tylko ten przypadek' })
  declare case: string

  @flags.boolean({ description: 'Zapisz wynik jako baseline' })
  declare saveBaseline: boolean

  @flags.number({ description: 'Dopuszczalny spadek wyniku względem baseline', default: 5 })
  declare maxDrop: number

  @flags.number({ description: 'Liczba uruchomień każdego przypadku', default: 1 })
  declare runs: number

  async run() {
    const { default: app } = await import('@adonisjs/core/services/app')
    const { getProvider } = await import('#services/ai/provider')
    const { PROMPT_VERSION } = await import('#services/design/prompts')
    const { loadCases, runCase } = await import('#services/design/eval')

    const provider = getProvider()
    const cases = await loadCases(app.makePath('tests/eval/cases'), this.case)
    if (!cases.length) {
      this.logger.error('Brak przypadków.')
      this.exitCode = 1
      return
    }
    this.logger.info(
      `Dostawca: ${provider.name} (${provider.compositionModel}), prompt ${PROMPT_VERSION}, przypadków: ${cases.length}`
    )

    const runs = Math.max(1, Math.min(10, this.runs || 1))
    const results = []
    for (const c of cases) {
      this.logger.info(`→ ${c.name}${runs > 1 ? ` ×${runs}` : ''}…`)
      const all = []
      for (let i = 0; i < runs; i++) all.push(await runCase(c, provider))
      const scores = all.map((x) => x.score)
      const mean = scores.reduce((a, b) => a + b, 0) / runs
      const stdev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / runs)
      // Raport: ostatnie uruchomienie (szczegóły) ze średnim wynikiem całej serii.
      const r = { ...all[all.length - 1], score: Math.round(mean), runs: scores, stdev }
      results.push(r)
      if (runs > 1) this.logger.info(`   wyniki ${scores.join(', ')} · σ ${stdev.toFixed(1)}`)
      const line = [
        `${r.case}: ${r.score}/100`,
        `kolory ${r.colors.found.length}/${r.colors.expected}`,
        `fonty ${r.fonts.found.length}/${r.fonts.expected}`,
        `teksty ${r.text.found.length}/${r.text.expected}`,
        `zmyślenia ${r.violations.length}`,
        `zły CSS ${r.invalidCss.length}`,
        `jakość ${r.quality}`,
        `${Math.round(r.durationMs / 1000)} s, ${r.tokens.in + r.tokens.out} tok.`,
      ].join(' · ')
      if (r.error) this.logger.error(`${line} — ${r.error}`)
      else this.logger.info(line)
      for (const v of r.violations) this.logger.warning(`   ${v}`)
      if (r.colors.missing.length)
        this.logger.info(`   brak kolorów: ${r.colors.missing.join(', ')}`)
      if (r.text.missing.length) this.logger.info(`   brak tekstów: ${r.text.missing.join(' | ')}`)
    }

    // Dokumenty osobno (czytelne .md), raport JSON bez nich.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const docsDir = app.tmpPath('eval', `docs-${stamp}`)
    await mkdir(docsDir, { recursive: true })
    for (const r of results) {
      if (r.markdown) await writeFile(`${docsDir}/${r.case}.md`, r.markdown)
      delete r.markdown
    }
    this.logger.info(`Dokumenty: ${docsDir}`)

    const total = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    const report = {
      at: new Date().toISOString(),
      provider: provider.name,
      model: provider.compositionModel,
      promptVersion: PROMPT_VERSION,
      total,
      results,
    }
    await mkdir(app.tmpPath('eval'), { recursive: true })
    const file = app.tmpPath('eval', `report-${report.at.replace(/[:.]/g, '-')}.json`)
    await writeFile(file, JSON.stringify(report, null, 2))
    this.logger.success(`Wynik łączny: ${total}/100 — raport: ${file}`)

    const baselinePath = app.makePath('tests/eval/baseline.json')
    if (this.saveBaseline) {
      await writeFile(baselinePath, JSON.stringify(report, null, 2) + '\n')
      this.logger.success('Zapisano baseline.')
      return
    }
    try {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
      if (baseline.provider !== provider.name) {
        this.logger.info(
          `Baseline dla innego dostawcy (${baseline.provider}) — pomijam porównanie.`
        )
        return
      }
      let regressed = false
      for (const r of results) {
        const before = baseline.results.find((b: { case: string }) => b.case === r.case)
        if (!before) continue
        const diff = r.score - before.score
        const msg = `${r.case}: ${before.score} → ${r.score} (${diff >= 0 ? '+' : ''}${diff})`
        if (diff < -this.maxDrop) {
          regressed = true
          this.logger.error(msg)
        } else this.logger.info(msg)
      }
      if (regressed) this.exitCode = 1
    } catch {
      this.logger.info('Brak baseline — zapisz go flagą --save-baseline.')
    }
  }
}
