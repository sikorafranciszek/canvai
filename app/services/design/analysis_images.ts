import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import { vision } from '#config/ai'
import { rasterMimes } from '#config/assets'
import type Asset from '#models/asset'

/**
 * Obrazy materiału do analizy (AI-7):
 * - jedno skalowanie z ORYGINAŁU do limitu dostawcy (zamiast 1568 px → 1300 px);
 * - długi zrzut strony cięty na kafle (z zakładką), analizowane razem —
 *   inaczej 1440×8000 kurczy się do ~234×1300 i tekst jest nieczytelny;
 * - PDF: pierwsze strony rasteryzowane + ich tekst (zamiast samej nazwy pliku).
 */

export interface AnalysisImages {
  images: { buffer: Buffer; mime: string }[]
  /** Opis dla modelu: kafle jednej strony / strony PDF. */
  layout: 'single' | 'tiles' | 'pages'
  /** Tekst wyciągnięty z PDF (niezaufany — idzie do ogrodzonego bloku). */
  text?: string
}

const EDGE = vision.maxEdgePx
/** Zrzut wyższy niż ~1,8 szerokości to „długa strona” — tniemy na kafle. */
const TALL_RATIO = 1.8
const TILE_OVERLAP = 120
const MAX_TILES = 6
const PDF_PAGES = 3
const PDF_TEXT_CHARS = 4000

export function isTall(width: number | null, height: number | null): boolean {
  return Boolean(width && height && height / width > TALL_RATIO && height > EDGE * 1.5)
}

/** Kafle długiego obrazu: szerokość ≤ EDGE, wysokość kafla EDGE, zakładka TILE_OVERLAP. */
export async function tileImage(buffer: Buffer): Promise<Buffer[]> {
  const meta = await sharp(buffer).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) return []
  const step = EDGE - TILE_OVERLAP
  // Najwyższa strona mieszcząca się w MAX_TILES kaflach przy pełnej szerokości EDGE.
  const maxHeight = MAX_TILES * step + TILE_OVERLAP
  let width = Math.min(w, EDGE)
  let height = Math.round((h * width) / w)
  if (height > maxHeight) {
    width = Math.max(320, Math.floor((width * maxHeight) / height))
    height = Math.round((h * width) / w)
  }
  const resized = await sharp(buffer).rotate().resize(width, height).png().toBuffer()
  const tiles: Buffer[] = []
  for (let top = 0; top < height && tiles.length < MAX_TILES; top += step) {
    const tileHeight = Math.min(EDGE, height - top)
    if (tileHeight < TILE_OVERLAP && tiles.length) break
    tiles.push(
      await sharp(resized)
        .extract({ left: 0, top, width, height: tileHeight })
        .webp({ quality: 88 })
        .toBuffer()
    )
    if (top + tileHeight >= height) break
  }
  return tiles
}

async function single(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(EDGE, EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer()
}

/** Pierwsze strony PDF jako obrazy (≤ EDGE) i ich tekst. Błąd = `null` (analiza po nazwie). */
export async function pdfPages(
  data: Buffer,
  pages = PDF_PAGES
): Promise<{ images: Buffer[]; text: string } | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')
    const require = createRequire(import.meta.url)
    const fonts = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/')
    const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      standardFontDataUrl: fonts,
    })
    const doc = await task.promise
    const images: Buffer[] = []
    const texts: string[] = []
    try {
      for (let n = 1; n <= Math.min(pages, doc.numPages); n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(3, EDGE / Math.max(base.width, base.height))
        const viewport = page.getViewport({ scale })
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        await page.render({ canvas: canvas as never, viewport }).promise
        images.push(await sharp(canvas.toBuffer('image/png')).webp({ quality: 88 }).toBuffer())
        const content = await page.getTextContent()
        texts.push(
          content.items
            .map((i) => ('str' in i ? i.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
      }
    } finally {
      await task.destroy()
    }
    return { images, text: texts.filter(Boolean).join('\n\n').slice(0, PDF_TEXT_CHARS) }
  } catch (error) {
    logger.warn({ err: error }, 'pdf rasterization failed')
    return null
  }
}

async function bytes(key: string | null): Promise<Buffer | null> {
  if (!key) return null
  try {
    return Buffer.from(await drive.use().getBytes(key))
  } catch {
    return null
  }
}

/** Obrazy do analizy materiału albo `null` (analiza tylko po metadanych). */
export async function analysisImagesFor(asset: Asset): Promise<AnalysisImages | null> {
  if (asset.kind === 'pdf') {
    const data = await bytes(asset.storageKey)
    const pages = data ? await pdfPages(data) : null
    if (!pages?.images.length) return null
    return {
      images: pages.images.map((buffer) => ({ buffer, mime: 'image/webp' })),
      layout: 'pages',
      text: pages.text || undefined,
    }
  }
  if (asset.kind !== 'image') return null

  // Raster: oryginał (jedno skalowanie). SVG i reszta: gotowy wariant `analysis`.
  const original =
    asset.mime && rasterMimes.includes(asset.mime) ? await bytes(asset.storageKey) : null
  const source = original ?? (await bytes(asset.analysisKey))
  if (!source) return null
  if (original && isTall(asset.width, asset.height)) {
    const tiles = await tileImage(original)
    if (tiles.length > 1) {
      return { images: tiles.map((buffer) => ({ buffer, mime: 'image/webp' })), layout: 'tiles' }
    }
  }
  return { images: [{ buffer: await single(source), mime: 'image/webp' }], layout: 'single' }
}
