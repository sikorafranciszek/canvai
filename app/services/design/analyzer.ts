import { createHash } from 'node:crypto'
import { limits } from '#config/ai'
import type Asset from '#models/asset'
import AssetAnalysis from '#models/asset_analysis'
import { validateAssetAnalysis } from '#services/ai/schemas'
import { AiProviderError, type AiProvider, type AssetAnalysisData } from '#services/ai/types'
import { ANALYSIS_PROMPT_VERSION as PROMPT_VERSION } from '#services/design/prompts'
import { t } from '#services/i18n'
import { analysisImagesFor, isTall } from '#services/design/analysis_images'

/**
 * Etap 1: analiza assetów. Każdy asset analizowany osobno (równolegle, z
 * limitem współbieżności), wynik cache'owany po treść + model + prompt_version —
 * ponowna generacja nie płaci drugi raz za niezmienione materiały.
 */

export interface UsageTracker {
  tokensIn: number
  tokensOut: number
}

export interface AnalyzeProgress {
  done: number
  total: number
}

export interface AnalyzeOutcome {
  analyses: Map<number, AssetAnalysisData>
  analyzed: number
  cached: number
}

export function assetLinkMeta(asset: Asset): { title?: string; description?: string } | null {
  const link = (asset.position as { link?: { title?: string; description?: string } } | null)?.link
  return link ?? null
}

/**
 * Klucz treści assetu. Obraz: sha256 bajtów (analiza nie widzi nazwy pliku,
 * więc wynik zależy tylko od obrazu). PDF / plik / link: analiza opiera się na
 * nazwie i metadanych, więc wchodzą one do klucza — inaczej konto B dostałoby
 * analizę z nazwą pliku konta A.
 */
export function analysisCacheKey(asset: Asset): string {
  // Długie zrzuty analizowane kaflami (AI-7) — osobny klucz, reszta obrazów bez zmian.
  if (asset.sha256 && asset.kind === 'image') {
    return `sha256:${asset.sha256}${isTall(asset.width, asset.height) ? ':tiles-v1' : ''}`
  }
  // PDF: strony jako obrazy + tekst (wcześniej tylko nazwa pliku).
  if (asset.sha256 && asset.kind === 'pdf') {
    const named = JSON.stringify([asset.sha256, asset.filename, 'pages-v1'])
    return `pdf:${createHash('sha256').update(named).digest('hex')}`
  }
  if (asset.sha256) {
    const named = JSON.stringify([asset.sha256, asset.filename])
    return `${asset.kind}:${createHash('sha256').update(named).digest('hex')}`
  }
  const payload = JSON.stringify([asset.kind, asset.filename, assetLinkMeta(asset)])
  return `${asset.kind}:${createHash('sha256').update(payload).digest('hex')}`
}

/** `upcoming` — szacunek tokenów wejścia następnego wywołania (sprawdzany przed nim). */
export function assertTokenBudget(usage: UsageTracker, upcoming = 0): void {
  const total = usage.tokensIn + usage.tokensOut + upcoming
  if (total > limits.maxTokensPerGeneration) {
    throw new AiProviderError(
      t('gen.tokenLimit', { total, limit: limits.maxTokensPerGeneration }),
      false
    )
  }
}

async function findCached(cacheKey: string, model: string): Promise<AssetAnalysisData | null> {
  const row = await AssetAnalysis.query()
    .where('cache_key', cacheKey)
    .where('model', model)
    .where('prompt_version', PROMPT_VERSION)
    .where('status', 'ready')
    .orderBy('id', 'desc')
    .first()
  if (!row?.raw) return null
  try {
    return validateAssetAnalysis(row.raw)
  } catch {
    return null
  }
}

/** Czy analiza assetu jest już w cache (ponowna generacja nie płaci za nią). */
export async function isAnalysisCached(asset: Asset, model: string): Promise<boolean> {
  return (await findCached(analysisCacheKey(asset), model)) !== null
}

/** Prosta pula: co najwyżej `concurrency` zadań naraz, kolejność wyników zachowana. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

export async function analyzeAssets(
  assets: Asset[],
  provider: AiProvider,
  usage: UsageTracker,
  onProgress: (progress: AnalyzeProgress) => Promise<void> | void
): Promise<AnalyzeOutcome> {
  const analyses = new Map<number, AssetAnalysisData>()
  let analyzed = 0
  let cached = 0
  let done = 0
  const total = assets.length

  await onProgress({ done, total })

  await pool(assets, limits.analysisConcurrency, async (asset) => {
    const cacheKey = analysisCacheKey(asset)
    const hit = await findCached(cacheKey, provider.analysisModel)

    if (hit) {
      analyses.set(asset.id, hit)
      cached++
    } else {
      assertTokenBudget(usage)
      const prepared = await analysisImagesFor(asset)
      let result
      try {
        result = await provider.analyzeAsset({
          assetId: asset.id,
          kind: asset.kind,
          filename: asset.filename,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
          linkMeta: assetLinkMeta(asset),
          image: prepared?.images[0] ?? null,
          images: prepared?.images,
          layout: prepared?.layout,
          documentText: prepared?.text,
        })
      } catch (error) {
        // Nieudane próby też zużyły tokeny — liczą się do budżetu i kosztów.
        if (error instanceof AiProviderError && error.usage) {
          usage.tokensIn += error.usage.tokensIn
          usage.tokensOut += error.usage.tokensOut
        }
        const reason = error instanceof Error ? error.message : t('gen.unknownError')
        throw new AiProviderError(
          t('gen.assetFailed', { id: asset.id, name: asset.filename.slice(0, 80), reason }),
          error instanceof AiProviderError ? error.retryable : false
        )
      }
      usage.tokensIn += result.usage.tokensIn
      usage.tokensOut += result.usage.tokensOut
      assertTokenBudget(usage)

      await AssetAnalysis.create({
        assetId: asset.id,
        cacheKey,
        model: result.model,
        promptVersion: PROMPT_VERSION,
        status: 'ready',
        summary: result.data.summary,
        tags: result.data.tags,
        palette: result.data.palette,
        ocrText: result.data.ocrText || null,
        raw: result.data as unknown as Record<string, unknown>,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
      })
      analyses.set(asset.id, result.data)
      analyzed++
    }

    done++
    await onProgress({ done, total })
  })

  return { analyses, analyzed, cached }
}
