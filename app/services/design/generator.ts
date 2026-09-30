import { DateTime } from 'luxon'
import { limits } from '#config/ai'
import Asset from '#models/asset'
import { referencedAssetIds } from '#services/assets_service'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import type DesignDoc from '#models/design_doc'
import { getProvider } from '#services/ai/provider'
import {
  AiProviderError,
  InvalidModelOutputError,
  type AiProvider,
  type DesignSpec,
} from '#services/ai/types'
import { analyzeAssets, assertTokenBudget, type UsageTracker } from '#services/design/analyzer'
import {
  buildBoardContext,
  computeInputFingerprint,
  type BoardContext,
} from '#services/design/board_context'
import { PROMPT_VERSION } from '#services/design/prompts'
import { renderDesignMd } from '#services/design/renderer'
import { groundSpec } from '#services/design/spec'
import type { SceneDocument } from '#shared/scene'
import { t } from '#services/i18n'
import { entitlementsFor } from '#services/billing/plans'
import { chargedFor } from '#services/billing/credits'

/**
 * Orkiestracja generacji DESIGN.md:
 *   przygotowanie wejścia (assety + struktura płótna + odcisk)
 *   → etap 1: analiza assetów (cache)
 *   → etap 2: kompozycja + kontrola ugruntowania (z ponowieniem)
 *   → render markdown + sekcja 8 → zapis wersji.
 *
 * Dokument trafia do stanu `ready` WYŁĄCZNIE w całości. Każdy błąd kończy się
 * `failed` z czytelnym komunikatem — nigdy półproduktem udającym sukces.
 */

export interface GenerationInput {
  board: Board
  assets: Asset[]
  context: BoardContext
  fingerprint: string
  provider: AiProvider
}

export type GenerationProgress =
  | { stage: 'analyze'; done: number; total: number }
  | { stage: 'compose' | 'render'; done: number; total: number }

export async function prepareGeneration(
  board: Board,
  provider = getProvider()
): Promise<GenerationInput> {
  const scene = await BoardScene.query().where('board_id', board.id).first()
  const context = buildBoardContext((scene?.document ?? null) as SceneDocument | null)
  // Tylko materiały obecne na płótnie — usunięty element nie trafia do DESIGN.md,
  // nawet jeśli jego asset jeszcze czeka na sprzątnięcie.
  const onCanvas = referencedAssetIds(scene?.document ?? null)
  const assets = (await Asset.query().where('board_id', board.id).orderBy('id', 'asc')).filter(
    (a) => onCanvas.has(a.id)
  )

  const fingerprint = computeInputFingerprint({
    boardTitle: board.title,
    assets: assets.map((a) => ({
      id: a.id,
      sha256: a.sha256,
      filename: a.filename,
      userNote: a.userNote,
    })),
    context,
    promptVersion: PROMPT_VERSION,
    models: [provider.name, provider.analysisModel, provider.compositionModel],
  })

  return { board, assets, context, fingerprint, provider }
}

/** Czy tablica ma cokolwiek, z czego da się napisać dokument. */
export function hasContent(input: GenerationInput): boolean {
  return input.assets.length > 0 || input.context.items.some((it) => it.text)
}

/** Błąd przed pierwszym wywołaniem modelu (np. za dużo assetów). */
export function preflightError(input: GenerationInput): string | null {
  if (input.assets.length > limits.maxAssetsPerJob) {
    return t('doc.tooManyAssets', { count: input.assets.length, limit: limits.maxAssetsPerJob })
  }
  return null
}

export async function runGeneration(
  doc: DesignDoc,
  onProgress: (progress: GenerationProgress) => Promise<void> | void
): Promise<DesignDoc> {
  const started = Date.now()
  const board = await Board.findOrFail(doc.boardId)
  const input = await prepareGeneration(board)
  const { provider, assets, context } = input

  const preflight = preflightError(input)
  if (preflight) throw new AiProviderError(preflight, false)

  doc.status = 'running'
  doc.error = null
  doc.model = provider.compositionModel
  doc.promptVersion = PROMPT_VERSION
  doc.inputFingerprint = input.fingerprint
  await doc.save()

  const usage: UsageTracker = { tokensIn: 0, tokensOut: 0 }

  // Etap 1
  const { analyses, analyzed, cached } = await analyzeAssets(assets, provider, usage, (p) =>
    onProgress({ stage: 'analyze', done: p.done, total: p.total })
  )

  // Etap 2 — kompozycja z kontrolą ugruntowania; odrzucona odpowiedź wraca do
  // modelu z listą problemów, do `limits.maxRetries` razy.
  await onProgress({ stage: 'compose', done: 0, total: 1 })
  const composeAssets = assets.map((a) => ({
    id: a.id,
    filename: a.filename,
    kind: a.kind,
    userNote: a.userNote,
    onCanvas: context.items.some((it) => it.assetId === a.id),
    analysis: analyses.get(a.id)!,
  }))
  const allowedIds = assets.map((a) => a.id)

  let spec: DesignSpec | null = null
  let previousErrors: string[] = []
  for (let attempt = 0; attempt <= limits.maxRetries && !spec; attempt++) {
    assertTokenBudget(usage)
    const result = await provider.composeDocument({
      boardTitle: board.title,
      assets: composeAssets,
      context,
      previousErrors: previousErrors.length ? previousErrors : undefined,
      reasoning: doc.proMode,
    })
    usage.tokensIn += result.usage.tokensIn
    usage.tokensOut += result.usage.tokensOut
    doc.model = result.model

    const problems = groundSpec(result.data, allowedIds)
    if (problems.length === 0) spec = result.data
    else previousErrors = problems
  }
  if (!spec) {
    throw new InvalidModelOutputError(t('gen.notGrounded', { errors: previousErrors.join('; ') }))
  }

  // Render
  await onProgress({ stage: 'render', done: 0, total: 1 })
  const generatedAt = DateTime.utc()
  const { markdown, sources } = renderDesignMd(
    spec,
    assets.map((a) => ({ id: a.id, filename: a.filename, kind: a.kind, userNote: a.userNote })),
    {
      boardTitle: board.title,
      version: doc.version,
      model: doc.model ?? provider.compositionModel,
      promptVersion: PROMPT_VERSION,
      generatedAt: generatedAt.toFormat("yyyy-MM-dd HH:mm 'UTC'"),
    }
  )

  // Plan Free: stopka z linkiem (darmowa reklama); płatne plany — bez niej.
  const { limits: planLimits } = await entitlementsFor(board.userId)
  const content = planLimits.watermark
    ? `${markdown.trimEnd()}\n\n---\n\n_${t('billing.watermark')}_\n`
    : markdown

  doc.status = 'ready'
  doc.contentMd = content
  doc.spec = spec
  doc.creditsCharged = await chargedFor({ designDocId: doc.id })
  doc.sources = sources
  doc.generatedAt = generatedAt
  doc.usage = {
    assets: assets.length,
    analyzed,
    cached,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    durationMs: Date.now() - started,
  }
  await doc.save()
  return doc
}
