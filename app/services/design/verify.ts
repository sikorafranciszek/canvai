import type { AssetAnalysisData, DesignSpec } from '#services/ai/types'
import { allowsAspect, type AssetUsage } from '#shared/asset-usage'
import { normalizeHex } from '#services/ai/schemas'
import { enforceUsage, sameColor, verifyColorEvidence } from '#services/design/spec'

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
  /** Fonty niewymienione w materiałach → założenia. */
  fontsFlagged: string[]
  /** Hexy z opisów, których nie ma w tabeli kolorów. */
  strayHexes: string[]
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
// Fonty (AI-2)
// ---------------------------------------------------------------------------

const GENERIC_FAMILY = /^(system-ui|sans-serif|serif|monospace|cursive|ui-[a-z-]+|-apple-system)$/i

const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

function mentions(text: string | undefined, name: string): boolean {
  if (!text) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(fold(text))
}

/**
 * Font cytujący materiał musi być w nim NAZWANY: w analizie z `evidence:
 * named`, w tekście z obrazu albo w notatkach (np. style z Figmy). Krój
 * „rozpoznany” tylko z wyglądu to propozycja — † i pytanie z kategorią.
 */
export function verifyFontEvidence(spec: DesignSpec, evidence: Evidence): string[] {
  const flagged: string[] = []
  const allowed = evidence.assets.filter((a) => allowsAspect(a.usage ?? undefined, 'typography'))
  const notes = evidence.notes.join('\n')
  const namedIn = (a: EvidenceAsset, name: string) =>
    (a.analysis?.typography ?? []).some(
      (t) => t.family && t.evidence !== 'inferred' && mentions(t.family, name)
    ) || mentions(a.analysis?.ocrText, name)

  for (const f of spec.typography.families) {
    if (f.confirmed || f.assumed || GENERIC_FAMILY.test(f.name.trim())) continue
    const name = fold(f.name)
    const cited = allowed.filter((a) => f.sources.includes(a.id))
    if (cited.some((a) => namedIn(a, name))) continue
    const elsewhere = allowed.filter((a) => namedIn(a, name))
    if (elsewhere.length) {
      f.sources = elsewhere.map((a) => a.id)
      continue
    }
    if (mentions(notes, name)) continue

    const category = cited
      .flatMap((a) => a.analysis?.typography ?? [])
      .map((t) => t.category)
      .find(Boolean)
    f.assumed = true
    f.sources = []
    flagged.push(f.name)
    spec.openQuestions.push(
      `Typeface: "${f.name}" is not named in the materials — it is a proposal${category ? ` for a ${category}` : ''}. Confirm the real font family.`
    )
  }
  return flagged
}

// ---------------------------------------------------------------------------
// Hexy w opisach (AI-4)
// ---------------------------------------------------------------------------

/**
 * Hexy wpisane w opisy komponentów, prompty i ściągawki, których nie ma w tabeli
 * kolorów — narzędzie do kodu użyłoby ich jako tokenów. Pytanie w Open Questions.
 */
export function scanStrayHexes(spec: DesignSpec): string[] {
  const known = spec.colors.map((c) => c.hex)
  const places: [string, string][] = [
    ...spec.components.flatMap((c) =>
      [c.description, ...c.states].map((t): [string, string] => [c.name, t])
    ),
    ...spec.agentGuide.componentPrompts.map((t): [string, string] => ['component prompts', t]),
    ...spec.agentGuide.quickColors.map((q): [string, string] => ['quick colors', q.value]),
    ...spec.surfaces.map((x): [string, string] => [`surface ${x.name}`, x.value]),
    ['overview', spec.overview],
    ['elevation', spec.elevation],
  ]
  const stray = new Map<string, Set<string>>()
  for (const [where, text] of places) {
    for (const m of text.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
      const hex = normalizeHex(m[0])
      if (!hex || known.some((k) => sameColor(k, hex))) continue
      if (!stray.has(hex)) stray.set(hex, new Set())
      stray.get(hex)!.add(where)
    }
  }
  if (stray.size) {
    const list = [...stray]
      .slice(0, 12)
      .map(([hex, where]) => `${hex} (${[...where].slice(0, 3).join(', ')})`)
      .join('; ')
    spec.openQuestions.push(
      `These colors appear in descriptions but not in the color tokens — confirm them or replace with a token: ${list}.`
    )
  }
  return [...stray.keys()]
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
  // Paleta + kolory tekstów (AI-4).
  const colorsFlagged = verifyColorEvidence(
    spec,
    new Map(
      evidence.assets
        .filter((a) => allowsAspect(a.usage ?? undefined, 'colors'))
        .map((a) => [
          a.id,
          [
            ...(a.analysis?.palette ?? []).map((p) => p.hex),
            ...(a.analysis?.textColors ?? []).map((c) => c.hex),
          ],
        ])
    )
  )
  const fontsFlagged = verifyFontEvidence(spec, evidence)
  // Cytaty mikrocopy tylko z materiałów dozwolonych dla tekstów i z notatek.
  const copyCorpus = [
    ...evidence.notes,
    ...evidence.assets
      .filter((a) => allowsAspect(a.usage ?? undefined, 'copy'))
      .map((a) => a.analysis?.ocrText ?? ''),
  ]
  const microcopyProposed = verifyMicrocopy(spec, copyCorpus)
  const brandsRemoved = filterSimilarBrands(spec, evidence.notes)
  const strayHexes = scanStrayHexes(spec)
  return {
    usageStripped,
    colorsFlagged,
    microcopyProposed,
    brandsRemoved,
    fontsFlagged,
    strayHexes,
  }
}
