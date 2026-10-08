import { limits } from '#config/ai'
import {
  AiProviderError,
  InvalidModelOutputError,
  type AiProvider,
  type ComposeInput,
  type DesignSpec,
} from '#services/ai/types'
import { assertTokenBudget, type UsageTracker } from '#services/design/analyzer'
import { composeInputPlan } from '#services/design/prompts'
import { groundSpec } from '#services/design/spec'
import { verifySpec, type Evidence, type VerifyReport } from '#services/design/verify'
import { runWithLocale, t } from '#services/i18n'

/**
 * Etap 2 — kompozycja z kontrolą ugruntowania i weryfikacją. Jedna funkcja dla
 * produkcji (`generator.ts`) i ewaluacji (`eval.ts`, AI-12): wynik ewaluacji
 * mówi prawdę o tym, co dostaje klient.
 *
 * - budżet wejścia (AI-5): szacunek przed wywołaniem, za duża tablica skracana
 *   stopniami (ostrzeżenie w Open Questions);
 * - jeden limit wywołań (AI-6): odrzucona odpowiedź (schemat, ugruntowanie)
 *   wraca do modelu z listą problemów po angielsku;
 * - `verifySpec`: role materiałów, kolory, fonty, cytaty, marki.
 */

export interface ComposeRun {
  spec: DesignSpec
  model: string
  report: VerifyReport
  trimmed: boolean
  calls: number
}

function addUsage(tracker: UsageTracker, add: { tokensIn: number; tokensOut: number }) {
  tracker.tokensIn += add.tokensIn
  tracker.tokensOut += add.tokensOut
}

export async function composeVerifiedSpec(opts: {
  provider: AiProvider
  input: Omit<ComposeInput, 'previousErrors'>
  usage: UsageTracker
  evidence: Evidence
}): Promise<ComposeRun> {
  const { provider, input, usage } = opts
  const plan = composeInputPlan(input)
  const allowedIds = input.assets.map((a) => a.id)

  let spec: DesignSpec | null = null
  let model = provider.compositionModel
  let previousErrors: string[] = []
  let calls = 0
  while (calls < limits.maxComposeCalls && !spec) {
    calls++
    assertTokenBudget(usage, plan.tokens)
    let result: Awaited<ReturnType<AiProvider['composeDocument']>>
    try {
      result = await provider.composeDocument({
        ...input,
        previousErrors: previousErrors.length ? previousErrors : undefined,
      })
    } catch (error) {
      // Tokeny nieudanych prób też się liczą (budżet, koszty).
      if (error instanceof AiProviderError && error.usage) addUsage(usage, error.usage)
      if (error instanceof InvalidModelOutputError) {
        previousErrors = [error.message]
        continue
      }
      throw error
    }
    addUsage(usage, result.usage)
    model = result.model

    const problems = runWithLocale('en', () => groundSpec(result.data, allowedIds))
    if (problems.length === 0) spec = result.data
    else previousErrors = problems
  }
  if (!spec) {
    // Bez ponawiania całego zadania — kolejne próby kosztowałyby tyle samo.
    throw new AiProviderError(t('gen.notGrounded', { errors: previousErrors.join('; ') }), false)
  }
  if (plan.trimmed) {
    spec.openQuestions.push(
      'This board has many materials, so their extracted text and descriptions were shortened before composing. Check that key screens are covered, or generate from a smaller selection.'
    )
  }
  const report = verifySpec(spec, opts.evidence)
  return { spec, model, report, trimmed: plan.trimmed, calls }
}
