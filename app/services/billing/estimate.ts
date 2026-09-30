import { costs } from '#config/billing'
import { isAnalysisCached } from '#services/design/analyzer'
import type { GenerationInput } from '#services/design/generator'

export interface CostEstimate {
  credits: number
  newMaterials: number
  cachedMaterials: number
  proMode: boolean
}

/**
 * Koszt generacji w kredytach: nowe/zmienione materiały + złożenie dokumentu,
 * ×2 w trybie Pro. Materiały z cache są darmowe. Ta sama liczba jest pokazywana
 * przed generacją i pobierana po sukcesie.
 */
export async function estimateGeneration(
  input: GenerationInput,
  proMode: boolean
): Promise<CostEstimate> {
  let cachedMaterials = 0
  for (const asset of input.assets) {
    if (await isAnalysisCached(asset, input.provider.analysisModel)) cachedMaterials++
  }
  const newMaterials = input.assets.length - cachedMaterials
  const base = newMaterials * costs.perMaterial + costs.compose
  return {
    credits: proMode ? base * costs.proMultiplier : base,
    newMaterials,
    cachedMaterials,
    proMode,
  }
}
