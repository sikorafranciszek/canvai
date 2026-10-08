import type { AssetAnalysisData, DesignSpec } from '#services/ai/types'
import { allowsAspect, type AssetUsage } from '#shared/asset-usage'
import { enforceUsage, verifyColorEvidence } from '#services/design/spec'

/**
 * Weryfikacja specyfikacji po kompozycji — wspólna dla produkcji i ewaluacji
 * (`eval.ts`), żeby wynik ewaluacji mówił prawdę o tym, co dostaje klient.
 *
 * Model może się mylić albo „dopychać” dokument wiedzą ogólną; tutaj kod
 * porównuje to, co napisał, z tym, co naprawdę jest w materiałach, i oznacza
 * resztę jako założenia † (albo usuwa, gdy nie ma prawa się pojawić).
 */

export interface EvidenceAsset {
  id: number
  usage?: AssetUsage | null
  analysis?: AssetAnalysisData | null
}

export interface Evidence {
  assets: EvidenceAsset[]
  /** Teksty napisane przez ludzi: tytuł tablicy, notatki materiałów, teksty na płótnie. */
  notes: string[]
}

export interface VerifyReport {
  /** Odwołania zdjęte przez rolę/aspekty materiałów. */
  usageStripped: string[]
  /** Kolory bez pokrycia w paletach → założenia. */
  colorsFlagged: string[]
  /** Przykłady mikrocopy bez pokrycia w tekstach → propozycje. */
  microcopyProposed: string[]
  /** Usunięte „podobne marki” (niewymienione przez klienta). */
  brandsRemoved: string[]
}

// ---------------------------------------------------------------------------
// Mikrocopy (AI-3)
// ---------------------------------------------------------------------------

const PROPOSED_LEAD =
  /^\s*(?:[([]\s*proposed\s*[)\]]\s*[:\-–—]?\s*|proposed\s*(?:[:\-–—]\s*|\s+(?=["„“'])))/i
const PROPOSED_TAIL = /\s*[([]\s*proposed\s*[)\]]\s*$/i

/** Czy przykład jest oznaczony jako propozycja („Proposed: …”, „(Proposed) …”, „… (proposed)”). */
export function isProposed(example: string): boolean {
  return PROPOSED_LEAD.test(example) || PROPOSED_TAIL.test(example)
}

/** Treść przykładu bez znacznika propozycji i otaczających cudzysłowów. */
export function stripProposed(example: string): string {
  return example
    .replace(PROPOSED_LEAD, '')
    .replace(PROPOSED_TAIL, '')
    .trim()
    .replace(/^["„“”'‘’]+|["„“”'‘’]+$/g, '')
    .trim()
}

/** Do porównań: bez wielkości liter, cudzysłowów, nadmiarowych spacji i końcowej interpunkcji. */
export function normalizeCopy(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["„“”'‘’«»`]/g, '')
    .replace(/[\s ]+/g, ' ')
    .replace(/[\s.,!?…:;]+$/g, '')
    .trim()
}

/**
 * Przykład mikrocopy podany jako cytat musi występować w tekście materiałów
 * (OCR) albo w notatkach. Inaczej to propozycja modelu — dostaje znacznik
 * „Proposed: ”, żeby nie udawała słów klienta. Zwraca przeniesione przykłady.
 */
export function verifyMicrocopy(spec: DesignSpec, corpus: string[]): string[] {
  const haystack = normalizeCopy(corpus.join('\n'))
  const flagged: string[] = []
  spec.voice.examples = spec.voice.examples
    .map((example) => {
      const core = stripProposed(example)
      if (!core) return ''
      if (isProposed(example)) return `Proposed: ${core}`
      const needle = normalizeCopy(core)
      if (needle && haystack.includes(needle)) return core
      flagged.push(core)
      return `Proposed: ${core}`
    })
    .filter(Boolean)
  return flagged
}

// ---------------------------------------------------------------------------
// Podobne marki (AI-1)
// ---------------------------------------------------------------------------

/**
 * „Similar brands” tylko wtedy, gdy klient sam je wymienił (tytuł, notatki,
 * teksty na płótnie) — inaczej to wiedza modelu, nie materiały.
 */
export function filterSimilarBrands(spec: DesignSpec, notes: string[]): string[] {
  const text = notes.join('\n').normalize('NFKC').toLowerCase()
  const removed: string[] = []
  spec.similarBrands = spec.similarBrands.filter((b) => {
    const name = b.name.normalize('NFKC').toLowerCase().trim()
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const named =
      name.length > 1 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text)
    if (!named) removed.push(b.name)
    return named
  })
  return removed
}

// ---------------------------------------------------------------------------
// Całość
// ---------------------------------------------------------------------------

export function verifySpec(spec: DesignSpec, evidence: Evidence): VerifyReport {
  const usages = new Map(
    evidence.assets.filter((a) => a.usage).map((a) => [a.id, a.usage as AssetUsage])
  )
  // Kategorie materiałów: z inspiracji „tylko typografia” nie wolno brać kolorów itd.
  const usageStripped = enforceUsage(spec, usages)
  // Kolory, których nie widać w materiałach dozwolonych dla kolorów, to propozycje → †.
  const colorsFlagged = verifyColorEvidence(
    spec,
    new Map(
      evidence.assets
        .filter((a) => allowsAspect(a.usage ?? undefined, 'colors'))
        .map((a) => [a.id, (a.analysis?.palette ?? []).map((p) => p.hex)])
    )
  )
  // Cytaty mikrocopy tylko z materiałów dozwolonych dla tekstów i z notatek.
  const copyCorpus = [
    ...evidence.notes,
    ...evidence.assets
      .filter((a) => allowsAspect(a.usage ?? undefined, 'copy'))
      .map((a) => a.analysis?.ocrText ?? ''),
  ]
  const microcopyProposed = verifyMicrocopy(spec, copyCorpus)
  const brandsRemoved = filterSimilarBrands(spec, evidence.notes)
  return { usageStripped, colorsFlagged, microcopyProposed, brandsRemoved }
}
