import { createHash } from 'node:crypto'
import type { SceneDocument, SceneElement } from '#shared/scene'

/**
 * Struktura płótna jako sygnał dla etapu 2 (lens 11: „layout as signal”).
 *
 * Model nie dostaje zrzutu całej tablicy — dostaje ustrukturyzowany opis:
 * - `items` — obrazy (A<id>) i notatki/teksty (N<n>) z pozycją,
 * - `frames` — prostokąty/elipsy, które obejmują inne elementy (grupy/ekrany),
 * - `flows` — strzałki rozwiązane do elementów na początku i końcu,
 * - `readingOrder` — kolejność czytania (wiersze od góry, w wierszu od lewej).
 *
 * Moduł jest czysty (bez bazy/IO) — testowany unitowo.
 */

export interface ContextItem {
  /** `A<assetId>` dla obrazów/kart linków, `N<n>` dla notatek i tekstów. */
  ref: string
  type: 'image' | 'sticky' | 'text'
  assetId: number | null
  text: string | null
  x: number
  y: number
  width: number
  height: number
  frame: string | null
  /** Etykieta ramki z szablonu tablicy (nazwa ekranu) — sama nie jest treścią. */
  label?: boolean
}

export interface ContextFrame {
  ref: string
  shape: 'rectangle' | 'ellipse'
  /** Nazwa ekranu: z narzędzia ramki albo etykiety szablonu nad ramką (FEAT-7). */
  name?: string
  x: number
  y: number
  width: number
  height: number
  contains: string[]
}

export interface ContextFlow {
  from: string
  to: string
}

export interface BoardContext {
  items: ContextItem[]
  frames: ContextFrame[]
  flows: ContextFlow[]
  readingOrder: string[]
  /** Ile elementów rysunkowych (linie, odręczne) pominięto jako szum. */
  drawings: number
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Ile px od krawędzi elementu może kończyć się strzałka, by go „dotykać”. */
const ARROW_SNAP_PX = 80
/** Tolerancja wiersza przy kolejności czytania. */
const ROW_TOLERANCE_PX = 120

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function round(value: number): number {
  return Math.round(value)
}

/** Ramka elementu w przestrzeni sceny (bez obrotu — wystarczy do topologii). */
function boxOf(el: SceneElement): Box | null {
  switch (el.type) {
    case 'rectangle':
    case 'ellipse':
    case 'sticky':
    case 'image':
      return { x: num(el.x), y: num(el.y), width: num(el.width), height: num(el.height) }
    case 'text': {
      const fontSize = num(el.fontSize, 16)
      const lines = (el.text ?? '').split('\n')
      const longest = lines.reduce((m, l) => Math.max(m, l.length), 0)
      return {
        x: num(el.x),
        y: num(el.y),
        width: num(el.width, longest * fontSize * 0.6),
        height: lines.length * fontSize * 1.2,
      }
    }
    default:
      return null
  }
}

function contains(outer: Box, inner: Box): boolean {
  const cx = inner.x + inner.width / 2
  const cy = inner.y + inner.height / 2
  return (
    cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height
  )
}

function distanceToBox(p: { x: number; y: number }, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height))
  return Math.hypot(dx, dy)
}

function area(b: Box): number {
  return Math.max(0, b.width) * Math.max(0, b.height)
}

function parseAssetId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function buildBoardContext(document: SceneDocument | null | undefined): BoardContext {
  const elements = Array.isArray(document?.elements) ? document.elements : []

  const items: (ContextItem & { box: Box })[] = []
  const shapeCandidates: { el: SceneElement; box: Box }[] = []
  const arrows: SceneElement[] = []
  let drawings = 0
  let noteCounter = 0

  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    // Wskazówki szablonu („wrzuć tu logo”) to instrukcja dla człowieka, nie dane.
    if ((el as { hint?: unknown }).hint === true) continue
    const box = boxOf(el)

    if (el.type === 'image' && box) {
      const assetId = parseAssetId(el.assetId)
      if (assetId === null) continue
      items.push({
        ref: `A${assetId}`,
        type: 'image',
        assetId,
        text: null,
        ...roundBox(box),
        frame: null,
        box,
      })
    } else if ((el.type === 'sticky' || el.type === 'text') && box) {
      const text = typeof el.text === 'string' ? el.text.trim() : ''
      const assetId = el.type === 'sticky' ? parseAssetId(el.assetId) : null
      // Karta linku (sticky z assetId) jest reprezentantem assetu, nie notatką.
      const ref = assetId !== null ? `A${assetId}` : `N${++noteCounter}`
      if (!text && assetId === null) continue
      items.push({
        ref,
        type: el.type,
        assetId,
        text: text ? text.slice(0, 1000) : null,
        ...roundBox(box),
        frame: null,
        ...((el as { label?: unknown }).label === true ? { label: true } : {}),
        box,
      })
    } else if ((el.type === 'rectangle' || el.type === 'ellipse') && box) {
      shapeCandidates.push({ el, box })
    } else if (el.type === 'arrow') {
      arrows.push(el)
    } else {
      drawings++
    }
  }

  // Ramki: kształty, które obejmują co najmniej jeden element treści.
  // Każdy element trafia do NAJMNIEJSZEJ obejmującej go ramki.
  const frames: (ContextFrame & { box: Box })[] = []
  let frameCounter = 0
  for (const { el, box } of shapeCandidates) {
    const named = typeof (el as { frameName?: unknown }).frameName === 'string'
    // Nazwana ramka (narzędzie ramki) jest ekranem także wtedy, gdy jest pusta.
    if (!named && !items.some((it) => contains(box, it.box) && area(box) > area(it.box))) continue
    const frameName = named ? String((el as { frameName: string }).frameName).trim() : ''
    // Etykieta szablonu tuż nad ramką („Hero (pierwszy ekran)”) też nazywa ekran.
    const label = items.find(
      (it) =>
        it.label &&
        it.text &&
        it.box.y + it.box.height <= box.y + 8 &&
        it.box.y + it.box.height >= box.y - 80 &&
        it.box.x < box.x + box.width &&
        it.box.x + it.box.width > box.x
    )
    const name = (frameName || label?.text || '').slice(0, 80)
    frames.push({
      ref: `F${++frameCounter}`,
      shape: el.type as 'rectangle' | 'ellipse',
      ...(name ? { name } : {}),
      ...roundBox(box),
      contains: [],
      box,
    })
  }
  for (const item of items) {
    const owner = frames
      .filter((f) => contains(f.box, item.box) && area(f.box) > area(item.box))
      .sort((a, b) => area(a.box) - area(b.box))[0]
    if (owner) {
      item.frame = owner.ref
      owner.contains.push(item.ref)
    }
  }

  // Strzałki: początek i koniec przypinamy do najbliższego elementu/ramki.
  const targets: { ref: string; box: Box; isFrame: boolean }[] = [
    ...items.map((it) => ({ ref: it.ref, box: it.box, isFrame: false })),
    ...frames.map((f) => ({ ref: f.ref, box: f.box, isFrame: true })),
  ]
  // Element w zasięgu ma pierwszeństwo przed ramką, która go obejmuje —
  // strzałka kończąca się tuż przy ekranie wewnątrz ramki wskazuje ekran.
  const nearest = (p: { x: number; y: number }): string | null => {
    let best: { ref: string; d: number } | null = null
    for (const preferFrames of [false, true]) {
      for (const t of targets) {
        if (t.isFrame !== preferFrames) continue
        const d = distanceToBox(p, t.box)
        if (d <= ARROW_SNAP_PX && (!best || d < best.d)) best = { ref: t.ref, d }
      }
      if (best) return best.ref
    }
    return null
  }

  const flows: ContextFlow[] = []
  const seenFlows = new Set<string>()
  for (const arrow of arrows) {
    if (arrow.type !== 'arrow' || !Array.isArray(arrow.points) || arrow.points.length < 2) continue
    const ox = num(arrow.x)
    const oy = num(arrow.y)
    const first = arrow.points[0]
    const last = arrow.points[arrow.points.length - 1]
    const from = nearest({ x: ox + num(first.x), y: oy + num(first.y) })
    const to = nearest({ x: ox + num(last.x), y: oy + num(last.y) })
    if (!from || !to || from === to) continue
    const key = `${from}->${to}`
    if (seenFlows.has(key)) continue
    seenFlows.add(key)
    flows.push({ from, to })
  }

  const readingOrder = [...items]
    .sort((a, b) => {
      if (Math.abs(a.box.y - b.box.y) > ROW_TOLERANCE_PX) return a.box.y - b.box.y
      return a.box.x - b.box.x
    })
    .map((it) => it.ref)
    .filter((ref, i, arr) => arr.indexOf(ref) === i)

  return {
    items: items.map(({ box: _box, ...rest }) => rest),
    frames: frames.map(({ box: _box, ...rest }) => rest),
    flows,
    readingOrder,
    drawings,
  }
}

function roundBox(b: Box): Box {
  return { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) }
}

export interface FingerprintAsset {
  id: number
  sha256: string | null
  filename: string
  userNote: string | null
  /** Rola i aspekty — zmiana kategorii wymaga nowej wersji dokumentu. */
  usage?: { role: string | null; aspects: string[] } | null
}

/**
 * Odcisk wejścia generacji. Ten sam odcisk = ta sama treść tablicy, te same
 * modele i ten sam prompt → ponowna generacja nic nie wniesie.
 */
export function computeInputFingerprint(input: {
  boardTitle: string
  assets: FingerprintAsset[]
  context: BoardContext
  promptVersion: string
  models: string[]
}): string {
  const assets = [...input.assets]
    .sort((a, b) => a.id - b.id)
    .map((a) => [
      a.id,
      a.sha256 ?? a.filename,
      a.userNote ?? '',
      // Domyślne użycie nie zmienia odcisku — stare dokumenty pozostają aktualne.
      ...(a.usage && (a.usage.role || a.usage.aspects.length)
        ? [`${a.usage.role ?? ''}:${a.usage.aspects.join(',')}`]
        : []),
    ])
  const payload = JSON.stringify({
    t: input.boardTitle,
    a: assets,
    c: input.context,
    p: input.promptVersion,
    m: input.models,
  })
  return createHash('sha256').update(payload).digest('hex')
}
