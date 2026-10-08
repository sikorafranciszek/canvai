import { createHash } from 'node:crypto'
import drive from '@adonisjs/drive/services/main'
import { limits } from '#config/ai'
import type Asset from '#models/asset'
import AssetAnalysis from '#models/asset_analysis'
import { validateAssetAnalysis } from '#services/ai/schemas'
import { AiProviderError, type AiProvider, type AssetAnalysisData } from '#services/ai/types'
import { ANALYSIS_PROMPT_VERSION as PROMPT_VERSION } from '#services/design/prompts'
import { t } from '#services/i18n'

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
  if (asset.sha256 && asset.kind === 'image') return `sha256:${asset.sha256}`
  if (asset.sha256) {
    const named = JSON.stringify([asset.sha256, asset.filename])
    return `${asset.kind}:${createHash('sha256').update(named).digest('hex')}`
  }
  const payload = JSON.stringify([asset.kind, asset.filename, assetLinkMeta(asset)])
  return `${asset.kind}:${createHash('sha256').update(payload).digest('hex')}`
}

export function assertTokenBudget(usage: UsageTracker): void {
  const total = usage.tokensIn + usage.tokensOut
  if (total > limits.maxTokensPerGeneration) {
    throw new AiProviderError(
      t('gen.tokenLimit', { total, limit: limits.maxTokensPerGeneration }),
      false
    )
  }
}

async function loadImage(asset: Asset): Promise<{ buffer: Buffer; mime: string } | null> {
  if (asset.kind !== 'image') return null
  const key = asset.analysisKey ?? (asset.mime !== 'image/svg+xml' ? asset.storageKey : null)
  if (!key) return null
  try {
    const bytes = await drive.use().getBytes(key)
    return {
      buffer: Buffer.from(bytes),
      mime: asset.analysisKey ? 'image/webp' : (asset.mime ?? 'application/octet-stream'),
    }
  } catch {
    return null
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
          image: await loadImage(asset),
        })
      } catch (error) {
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
