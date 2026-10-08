import { limits } from '#config/ai'
import logger from '@adonisjs/core/services/logger'
import {
  AiProviderError,
  InvalidModelOutputError,
  type AiProvider,
  type ClaimVerdict,
  type ComposeInput,
  type DesignSpec,
  type VerifyClaim,
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
  /** Krok weryfikacji (AI-8): ile twierdzeń bez dowodu; `null` = nie wykonano. */
  unsupported: number | null
}

/** Ile znaków tekstu z obrazu na materiał w materiale dowodowym weryfikacji. */
const EVIDENCE_OCR_CHARS = 600

/**
 * Krok weryfikacji (AI-8): drugi, tani przebieg — dla komponentów, ekranów
 * i przepływów model cytuje dowód z analiz, tekstu z obrazów i notatek albo
 * odpowiada null. Brak dowodu: komponent i ekran → założenie †, przepływ →
 * pytanie w Open Questions. Błąd kroku nie przerywa generacji (dokument
 * zostaje jak po weryfikacji kodem).
 */
export async function verifyClaimsStep(
  provider: AiProvider,
  spec: DesignSpec,
  evidence: Evidence,
  usage: UsageTracker
): Promise<number | null> {
  if (!provider.verifyClaims) return null
  const claims: VerifyClaim[] = [
    ...spec.components
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.assumed)
      .map(({ c, i }) => ({
        id: `c${i}`,
        kind: 'component' as const,
        text: `${c.name}: ${c.description.slice(0, 240)}`,
      })),
    ...spec.screens.map((s, i) => ({
      id: `s${i}`,
      kind: 'screen' as const,
      text: `${s.name}: ${s.purpose.slice(0, 200)}`,
    })),
    ...spec.flows.map((f, i) => ({ id: `f${i}`, kind: 'flow' as const, text: f.slice(0, 240) })),
  ]
  if (claims.length === 0) return 0
  const material = [
    ...evidence.assets.flatMap((a) =>
      a.analysis
        ? [
            {
              ref: `A${a.id}`,
              text: [
                a.analysis.summary,
                a.analysis.components.join('; '),
                a.analysis.layoutPatterns.join('; '),
                a.analysis.ocrText.slice(0, EVIDENCE_OCR_CHARS),
              ]
                .filter(Boolean)
                .join(' | '),
            },
          ]
        : []
    ),
    ...evidence.notes.map((text, i) => ({ ref: `N${i + 1}`, text: text.slice(0, 600) })),
  ]
  let verdicts: ClaimVerdict[]
  try {
    assertTokenBudget(usage)
    const result = await provider.verifyClaims({ claims, evidence: material })
    addUsage(usage, result.usage)
    verdicts = result.data
  } catch (error) {
    if (error instanceof AiProviderError && error.usage) addUsage(usage, error.usage)
    logger.warn({ err: error }, 'claim verification skipped')
    return null
  }
  const unsupported = new Set(verdicts.filter((v) => v.evidence === null).map((v) => v.id))
  spec.components.forEach((c, i) => {
    if (unsupported.has(`c${i}`)) {
      c.assumed = true
      c.sources = []
    }
  })
  spec.screens.forEach((s, i) => {
    if (unsupported.has(`s${i}`)) {
      s.assumed = true
      s.sources = []
    }
  })
  const dropped = spec.flows.filter((_, i) => unsupported.has(`f${i}`))
  if (dropped.length) {
    spec.flows = spec.flows.filter((_, i) => !unsupported.has(`f${i}`))
    spec.openQuestions.push(
      `Proposed flows not shown in the materials — confirm before building: ${dropped.join(' | ')}`
    )
  }
  return unsupported.size
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
  const unsupported = await verifyClaimsStep(provider, spec, opts.evidence, usage)
  return { spec, model, report, trimmed: plan.trimmed, calls, unsupported }
}
