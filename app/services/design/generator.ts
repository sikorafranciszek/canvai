import { DateTime } from 'luxon'
import { limits } from '#config/ai'
import Asset from '#models/asset'
import { referencedAssetIds } from '#services/assets_service'
import Board from '#models/board'
import BoardScene from '#models/board_scene'
import DesignDoc from '#models/design_doc'
import { getProvider } from '#services/ai/provider'
import {
  AiProviderError,
  REVISABLE_SECTIONS,
  type AiProvider,
  type DesignSpec,
  type RevisableSection,
} from '#services/ai/types'
import { analyzeAssets, cachedAnalyses, type UsageTracker } from '#services/design/analyzer'
import { composeVerifiedSpec } from '#services/design/compose'
import {
  buildBoardContext,
  computeInputFingerprint,
  type BoardContext,
} from '#services/design/board_context'
import { PROMPT_VERSION, SECTION_FIELDS } from '#services/design/prompts'
import { renderDesignMd } from '#services/design/renderer'
import type { Evidence } from '#services/design/verify'
import type { AssetAnalysisData } from '#services/ai/types'
import type { SceneDocument } from '#shared/scene'
import { runWithLocale, t } from '#services/i18n'
import { entitlementsFor } from '#services/billing/plans'
import { chargedFor } from '#services/billing/credits'
import { track } from '#services/analytics/collector'
import { recordAiUsage } from '#services/ops/ai_budget'
import { publish } from '#services/board_events'
import { printBrand } from '#services/portal'

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
      usage: a.usage,
    })),
    context,
    promptVersion: PROMPT_VERSION,
    models: [provider.name, provider.analysisModel, provider.compositionModel],
  })

  return { board, assets, context, fingerprint, provider }
}

/** Materiał dowodowy dla `verifySpec`: analizy, role materiałów i teksty ludzi. */
export function evidenceFor(
  board: Board,
  assets: Asset[],
  analyses: Map<number, AssetAnalysisData>,
  context: BoardContext
): Evidence {
  return {
    assets: assets.map((a) => ({ id: a.id, usage: a.usage, analysis: analyses.get(a.id) })),
    notes: [
      board.title,
      ...assets.map((a) => a.userNote ?? ''),
      ...context.items.map((it) => it.text ?? ''),
    ].filter(Boolean),
  }
}

/** Czy tablica ma cokolwiek, z czego da się napisać dokument. */
export function hasContent(input: GenerationInput): boolean {
  return input.assets.length > 0 || input.context.items.some((it) => it.text && !it.label)
}

/** Błąd przed pierwszym wywołaniem modelu (np. za dużo assetów). */
export function preflightError(input: GenerationInput): string | null {
  if (input.assets.length > limits.maxAssetsPerJob) {
    return t('doc.tooManyAssets', { count: input.assets.length, limit: limits.maxAssetsPerJob })
  }
  return null
}

/**
 * Plan Free: stopka z linkiem (darmowa reklama); płatne plany — bez niej.
 * Dokument jest po angielsku, więc stopka też (niezależnie od języka interfejsu).
 */
export async function withPlanFooter(markdown: string, userId: number): Promise<string> {
  const { limits: planLimits } = await entitlementsFor(userId)
  return planLimits.watermark
    ? `${markdown.trimEnd()}\n\n---\n\n_${runWithLocale('en', () => t('billing.watermark'))}_\n`
    : markdown
}

/** Nazwa marki agencji, gdy właściciel ma white-label; inaczej `null`. */
export async function whiteLabelName(userId: number): Promise<string | null> {
  const brand = await printBrand(userId)
  return brand.whiteLabel ? brand.name : null
}

/** Wersja bazowa poprawki poleceniem (FEAT-2). */
async function revisionBase(
  doc: DesignDoc
): Promise<{ spec: DesignSpec; section?: RevisableSection }> {
  const base = doc.editedFromVersion
    ? await DesignDoc.query()
        .where('board_id', doc.boardId)
        .where('version', doc.editedFromVersion)
        .first()
    : null
  if (!base?.spec) throw new AiProviderError(t('doc.revisionNoBase'), false)
  const section = (REVISABLE_SECTIONS as readonly string[]).includes(doc.revisedSection ?? '')
    ? (doc.revisedSection as RevisableSection)
    : undefined
  return { spec: base.spec, section }
}

/** Specyfikacja bazowa z podmienionymi polami jednej sekcji. */
export function mergeSection(
  base: DesignSpec,
  revised: DesignSpec,
  section: RevisableSection
): DesignSpec {
  const out = structuredClone(base) as unknown as Record<string, unknown>
  const src = revised as unknown as Record<string, unknown>
  for (const key of SECTION_FIELDS[section]) out[key] = src[key]
  // Pytania z nowej wersji dopisujemy — mogą dotyczyć przepisanej sekcji.
  const questions = new Set([...base.openQuestions, ...revised.openQuestions])
  out.openQuestions = [...questions]
  return out as unknown as DesignSpec
}

/** Generacja anulowana przez użytkownika — bez ponawiania. */
export class GenerationCancelled extends AiProviderError {
  constructor() {
    super(t('doc.cancelled'), false)
    this.name = 'GenerationCancelled'
  }
}

/** Punkt kontrolny: czy dokument nadal jest w toku (nie został anulowany). */
async function assertActive(docId: number): Promise<void> {
  const row = await DesignDoc.query().where('id', docId).select('status').first()
  if (!row || (row.status !== 'running' && row.status !== 'queued')) {
    throw new GenerationCancelled()
  }
}

export async function runGeneration(
  doc: DesignDoc,
  onProgress: (progress: GenerationProgress) => Promise<void> | void
): Promise<DesignDoc> {
  const started = Date.now()
  const board = await Board.findOrFail(doc.boardId)
  const input = await prepareGeneration(board)
  const { provider } = input

  const preflight = preflightError(input)
  if (preflight) throw new AiProviderError(preflight, false)

  // Start tylko z kolejki — dokument anulowany w międzyczasie (UX-11) nie rusza.
  const claimed = await DesignDoc.query()
    .where('id', doc.id)
    .whereIn('status', ['queued', 'running'])
    .update({
      status: 'running',
      error: null,
      model: provider.compositionModel,
      prompt_version: PROMPT_VERSION,
      input_fingerprint: input.fingerprint,
    })
  if (!(Array.isArray(claimed) ? Number(claimed[0]) : Number(claimed))) {
    throw new GenerationCancelled()
  }
  doc.status = 'running'
  doc.error = null
  doc.model = provider.compositionModel
  doc.promptVersion = PROMPT_VERSION
  doc.inputFingerprint = input.fingerprint

  const usage: UsageTracker = { tokensIn: 0, tokensOut: 0 }
  try {
    return await generate(doc, input, usage, started, onProgress)
  } finally {
    // Zużycie liczone także przy błędzie — tokeny i tak zostały zużyte.
    await recordAiUsage(board.userId, usage)
  }
}

async function generate(
  doc: DesignDoc,
  input: GenerationInput,
  usage: UsageTracker,
  started: number,
  onProgress: (progress: GenerationProgress) => Promise<void> | void
): Promise<DesignDoc> {
  const { provider, context, board } = input

  // Poprawka poleceniem (FEAT-2): bazowa specyfikacja i analizy wyłącznie z cache.
  const revision = doc.instruction ? await revisionBase(doc) : null

  // Etap 1
  const { analyses, analyzed, cached } = revision
    ? await (async () => {
        const hits = await cachedAnalyses(input.assets, provider.analysisModel)
        return { analyses: hits, analyzed: 0, cached: hits.size }
      })()
    : await analyzeAssets(input.assets, provider, usage, async (p) => {
        if (p.done > 0) await assertActive(doc.id)
        await onProgress({ stage: 'analyze', done: p.done, total: p.total })
      })
  // Poprawka widzi tylko materiały z gotową analizą (nowe wymagają pełnej generacji).
  const assets = revision ? input.assets.filter((a) => analyses.has(a.id)) : input.assets

  await assertActive(doc.id)
  // Etap 2 — kompozycja, ugruntowanie i weryfikacja (wspólne z ewaluacją).
  await onProgress({ stage: 'compose', done: 0, total: 1 })
  const composeAssets = assets.map((a) => ({
    id: a.id,
    filename: a.filename,
    kind: a.kind,
    userNote: a.userNote,
    onCanvas: context.items.some((it) => it.assetId === a.id),
    analysis: analyses.get(a.id)!,
    usage: a.usage,
  }))
  const composeInput = {
    boardTitle: board.title,
    assets: composeAssets,
    context,
    reasoning: doc.proMode,
  }
  const run = await composeVerifiedSpec({
    provider,
    input: composeInput,
    usage,
    evidence: evidenceFor(board, assets, analyses, context),
    call: revision
      ? (previousErrors) =>
          provider.reviseDocument({
            ...composeInput,
            previousErrors,
            currentSpec: revision.spec,
            instruction: doc.instruction!,
            section: revision.section,
          })
      : undefined,
  })
  doc.model = run.model
  // Regeneracja sekcji: reszta dokumentu dokładnie jak w wersji bazowej.
  const spec = revision?.section
    ? mergeSection(revision.spec, run.spec, revision.section)
    : run.spec
  // Weryfikacja poprawionej bazy może powtórzyć pytania, które baza już miała.
  if (revision) spec.openQuestions = [...new Set(spec.openQuestions)]

  await assertActive(doc.id)
  // Render
  await onProgress({ stage: 'render', done: 0, total: 1 })
  const generatedAt = DateTime.utc()
  const { markdown, sources } = renderDesignMd(
    spec,
    assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      kind: a.kind,
      userNote: a.userNote,
      usage: a.usage,
    })),
    {
      boardTitle: board.title,
      version: doc.version,
      generatedAt: generatedAt.toFormat("yyyy-MM-dd HH:mm 'UTC'"),
      preparedBy: await whiteLabelName(board.userId),
    }
  )

  const content = await withPlanFooter(markdown, board.userId)

  await assertActive(doc.id)
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
  publish(board.id, 'doc', { version: doc.version, status: 'ready' })
  track(
    'design_doc_ready',
    {
      version: doc.version,
      durationMs: doc.usage.durationMs,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      materials: assets.length,
      analyzed,
      cached,
      credits: doc.creditsCharged ?? 0,
      proMode: doc.proMode,
      model: doc.model,
    },
    { userId: board.userId, boardId: board.id }
  )
  return doc
}
