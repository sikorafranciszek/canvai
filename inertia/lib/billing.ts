/**
 * Saldo kredytów i plan (pasek boczny, panel DESIGN.md) + szacunek kosztu generacji.
 */
import { create } from 'zustand'

export type PlanId = 'free' | 'payg' | 'pro' | 'team' | 'agency'

export interface PlanLimits {
  boards: number | null
  materialsPerBoard: number | null
  versionsKept: number | null
  watermark: boolean
  exports: boolean
  proReasoning: boolean
  api?: boolean
  portal?: boolean
  brandKits?: boolean
  collaborators?: number | null
  whiteLabel?: boolean
}

export interface BillingSummary {
  plan: PlanId
  balance: number
  enforced: boolean
  /** Cena poprawki poleceniem / regeneracji sekcji (FEAT-2). */
  revisionCost?: number
  limits: PlanLimits
}

export interface CostEstimate {
  credits: number
  newMaterials: number
  cachedMaterials: number
  proMode: boolean
  unchanged: boolean
  balance: number
  enforced: boolean
}

interface BillingState {
  summary: BillingSummary | null
  load: () => Promise<void>
}

export const useBillingStore = create<BillingState>()((set) => ({
  summary: null,
  async load() {
    try {
      const res = await fetch('/api/billing', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { data: BillingSummary }
      set({ summary: body.data })
    } catch {
      // Saldo to informacja pomocnicza — brak sieci nie blokuje UI.
    }
  },
}))

export async function fetchEstimate(boardId: number, pro: boolean): Promise<CostEstimate | null> {
  try {
    const res = await fetch(`/api/boards/${boardId}/design-doc/estimate${pro ? '?pro=1' : ''}`, {
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    return ((await res.json()) as { data: CostEstimate }).data
  } catch {
    return null
  }
}

export type ExportFormat =
  | 'css'
  | 'tailwind'
  | 'tokens'
  | 'tailwind3'
  | 'scss'
  | 'figma'
  | 'cursor'
  | 'claude'
  | 'agents'
  | 'prompt'
  | 'storybook'

export function exportUrl(boardId: number, format: ExportFormat, version?: number) {
  const qs = new URLSearchParams({ format })
  if (version) qs.set('version', String(version))
  return `/api/boards/${boardId}/design-doc/export?${qs}`
}
