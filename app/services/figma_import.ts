import { safeFetch } from '#services/safe_fetch'

/**
 * Import z Figmy (REST API, osobisty token użytkownika):
 * - ramki z linku (konkretna ramka z `node-id` albo ramki pierwszej strony)
 *   eksportowane do PNG → materiały na tablicy;
 * - DOKŁADNE wartości z pliku: kolory wypełnień (z nazwami stylów), style
 *   tekstu (font, rozmiar, waga, interlinia), promienie i cienie → notatka dla
 *   AI. Dzięki temu DESIGN.md nie zgaduje fontów i kolorów z pikseli.
 */

export class FigmaError extends Error {
  constructor(
    public readonly code: 'bad_url' | 'auth' | 'not_found' | 'rate_limited' | 'empty' | 'failed',
    message: string
  ) {
    super(message)
  }
}

/** Podmieniane w testach (atrapa API Figmy). */
export const figmaApi = {
  base: 'https://api.figma.com',
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  download: async (url: string) => {
    const res = await safeFetch(url, { timeoutMs: 20_000, maxBytes: 15 * 1024 * 1024 })
    return { status: res.status, contentType: res.contentType, body: res.body }
  },
}

const MAX_FRAMES = 6
const MAX_NODES = 8000

export interface FigmaLink {
  fileKey: string
  nodeId: string | null
}

/** `https://www.figma.com/design/<key>/<name>?node-id=12-34` → klucz pliku i id węzła. */
export function parseFigmaUrl(raw: string): FigmaLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null
  const m = url.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,64})(?:\/|$)/)
  if (!m) return null
  const node = url.searchParams.get('node-id')
  const nodeId = node && /^\d+[-:]\d+$/.test(node) ? node.replace('-', ':') : null
  return { fileKey: m[1], nodeId }
}

async function api<T>(path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await figmaApi.fetch(`${figmaApi.base}${path}`, {
      headers: { 'X-Figma-Token': token },
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new FigmaError('failed', 'Figma API unreachable')
  }
  if (res.status === 403 || res.status === 401) throw new FigmaError('auth', 'Figma token rejected')
  if (res.status === 404) throw new FigmaError('not_found', 'Figma file not found')
  if (res.status === 429) throw new FigmaError('rate_limited', 'Figma rate limit')
  if (!res.ok) throw new FigmaError('failed', `Figma API HTTP ${res.status}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Style z drzewa węzłów
// ---------------------------------------------------------------------------

interface FigmaColor {
  r: number
  g: number
  b: number
  a: number
}

interface FigmaPaint {
  type: string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
}

interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  children?: FigmaNode[]
  fills?: FigmaPaint[]
  strokes?: FigmaPaint[]
  cornerRadius?: number
  rectangleCornerRadii?: number[]
  effects?: {
    type: string
    visible?: boolean
    color?: FigmaColor
    offset?: { x: number; y: number }
    radius: number
    spread?: number
  }[]
  styles?: Record<string, string>
  style?: {
    fontFamily?: string
    fontWeight?: number
    fontSize?: number
    lineHeightPx?: number
    letterSpacing?: number
  }
  absoluteBoundingBox?: { width: number; height: number }
}

export interface FigmaStyleSummary {
  colors: { hex: string; count: number; style: string | null; usage: 'text' | 'fill' | 'stroke' }[]
  text: {
    family: string
    size: number
    weight: number
    lineHeight: number | null
    count: number
    style: string | null
  }[]
  radii: { value: number; count: number }[]
  shadows: { css: string; count: number }[]
}

function hex(c: FigmaColor, opacity = 1): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  const alpha = (c.a ?? 1) * opacity
  return `#${to(c.r)}${to(c.g)}${to(c.b)}${alpha < 0.99 ? to(alpha) : ''}`
}

function bump<T extends { count: number }>(map: Map<string, T>, key: string, init: () => T) {
  const item = map.get(key) ?? init()
  item.count++
  map.set(key, item)
}

export function extractStyles(
  roots: FigmaNode[],
  styleNames: Record<string, string> = {}
): FigmaStyleSummary {
  const colors = new Map<string, FigmaStyleSummary['colors'][number]>()
  const text = new Map<string, FigmaStyleSummary['text'][number]>()
  const radii = new Map<string, FigmaStyleSummary['radii'][number]>()
  const shadows = new Map<string, FigmaStyleSummary['shadows'][number]>()
  let visited = 0

  const walk = (node: FigmaNode) => {
    if (visited++ > MAX_NODES || node.visible === false) return
    const isText = node.type === 'TEXT'
    const paints = (kind: 'fill' | 'stroke', list?: FigmaPaint[]) => {
      for (const p of list ?? []) {
        if (p.type !== 'SOLID' || p.visible === false || !p.color) continue
        const value = hex(p.color, p.opacity ?? 1)
        const style = node.styles?.[kind] ? (styleNames[node.styles[kind]] ?? null) : null
        const usage = kind === 'stroke' ? 'stroke' : isText ? 'text' : 'fill'
        bump(colors, `${value}|${usage}`, () => ({ hex: value, count: 0, style, usage }))
      }
    }
    paints('fill', node.fills)
    paints('stroke', node.strokes)

    if (isText && node.style?.fontFamily && node.style.fontSize) {
      const s = node.style
      const lh = s.lineHeightPx ? Math.round(s.lineHeightPx * 10) / 10 : null
      const key = `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${lh}`
      const style = node.styles?.text ? (styleNames[node.styles.text] ?? null) : null
      bump(text, key, () => ({
        family: s.fontFamily!,
        size: s.fontSize!,
        weight: s.fontWeight ?? 400,
        lineHeight: lh,
        count: 0,
        style,
      }))
    }

    const radius = node.cornerRadius ?? node.rectangleCornerRadii?.[0]
    if (radius && radius > 0) bump(radii, String(radius), () => ({ value: radius, count: 0 }))

    for (const e of node.effects ?? []) {
      if (e.visible === false || !e.color || !/SHADOW/.test(e.type)) continue
      const c = e.color
      const rgba = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${Math.round(c.a * 100) / 100})`
      const css = `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${e.offset?.x ?? 0}px ${e.offset?.y ?? 0}px ${e.radius}px ${e.spread ?? 0}px ${rgba}`
      bump(shadows, css, () => ({ css, count: 0 }))
    }

    for (const child of node.children ?? []) walk(child)
  }
  roots.forEach(walk)

  const top = <T extends { count: number }>(map: Map<string, T>, n: number) =>
    [...map.values()].sort((a, b) => b.count - a.count).slice(0, n)
  return {
    colors: top(colors, 16),
    text: top(text, 12).sort((a, b) => b.size - a.size),
    radii: top(radii, 6),
    shadows: top(shadows, 4),
  }
}

/** Notatka dla AI z dokładnymi wartościami (trafia na płótno jak notatka importu strony). */
export function figmaStyleNote(fileName: string, frames: string[], s: FigmaStyleSummary): string {
  const lines = [`Figma: ${fileName}${frames.length ? ` — ${frames.join(', ')}` : ''}`]
  lines.push('Exact values from the Figma file (prefer these over values read from the images):')
  if (s.colors.length) {
    lines.push(
      `Colors: ${s.colors
        .map((c) => `${c.hex}${c.style ? ` “${c.style}”` : ''} (${c.usage}, ${c.count}×)`)
        .join('; ')}`
    )
  }
  if (s.text.length) {
    lines.push(
      `Typography: ${s.text
        .map(
          (t) =>
            `${t.family} ${t.size}px${t.lineHeight ? `/${t.lineHeight}px` : ''} ${t.weight}${t.style ? ` “${t.style}”` : ''} (${t.count}×)`
        )
        .join('; ')}`
    )
  }
  if (s.radii.length)
    lines.push(`Corner radius: ${s.radii.map((r) => `${r.value}px (${r.count}×)`).join(', ')}`)
  if (s.shadows.length) lines.push(`Shadows: ${s.shadows.map((x) => x.css).join('; ')}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface FigmaFrameImage {
  id: string
  name: string
  buffer: Buffer
  mime: string
}

export interface FigmaImport {
  fileName: string
  frames: FigmaFrameImage[]
  styles: FigmaStyleSummary
  note: string
}

const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'INSTANCE'])

export async function importFigma(rawUrl: string, token: string): Promise<FigmaImport> {
  const link = parseFigmaUrl(rawUrl)
  if (!link) throw new FigmaError('bad_url', 'Not a Figma file link')

  const file = await api<{
    name: string
    document: FigmaNode
    styles?: Record<string, { name: string }>
  }>(`/v1/files/${link.fileKey}?depth=2`, token)
  const styleNames = Object.fromEntries(
    Object.entries(file.styles ?? {}).map(([id, s]) => [id, s.name])
  )

  let ids: string[]
  if (link.nodeId) {
    ids = [link.nodeId]
  } else {
    const page = file.document.children?.find((p) => (p.children ?? []).length) ?? null
    ids = (page?.children ?? [])
      .filter((n) => FRAME_TYPES.has(n.type) && n.visible !== false)
      .slice(0, MAX_FRAMES)
      .map((n) => n.id)
  }
  if (!ids.length) throw new FigmaError('empty', 'No frames to import')

  const nodes = await api<{
    nodes: Record<string, { document: FigmaNode; styles?: Record<string, { name: string }> } | null>
  }>(`/v1/files/${link.fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`, token)
  const roots: FigmaNode[] = []
  for (const entry of Object.values(nodes.nodes ?? {})) {
    if (!entry?.document) continue
    roots.push(entry.document)
    for (const [id, s] of Object.entries(entry.styles ?? {})) styleNames[id] = s.name
  }
  if (!roots.length) throw new FigmaError('not_found', 'Frame not found')
  const styles = extractStyles(roots, styleNames)

  // Duże ramki (długie strony) eksportujemy w skali 1, małe (komponenty) w 2.
  const images = await api<{ err: string | null; images: Record<string, string | null> }>(
    `/v1/images/${link.fileKey}?ids=${encodeURIComponent(roots.map((r) => r.id).join(','))}&format=png&scale=${roots.every((r) => (r.absoluteBoundingBox?.width ?? 0) < 600) ? 2 : 1}`,
    token
  )
  const frames: FigmaFrameImage[] = []
  for (const root of roots) {
    const url = images.images?.[root.id]
    if (!url) continue
    try {
      const img = await figmaApi.download(url)
      const mime = img.contentType.split(';')[0].trim().toLowerCase()
      if (img.status >= 200 && img.status < 300 && mime === 'image/png' && img.body.length) {
        frames.push({ id: root.id, name: root.name, buffer: img.body, mime })
      }
    } catch {
      // Jedna ramka bez obrazu nie przerywa importu — style i tak trafiają do notatki.
    }
  }

  return {
    fileName: file.name,
    frames,
    styles,
    note: figmaStyleNote(
      file.name,
      roots.map((r) => r.name),
      styles
    ),
  }
}
