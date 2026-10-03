import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { safeFetch } from '#services/safe_fetch'
import { readFile } from 'node:fs/promises'
import { Exception } from '@adonisjs/core/exceptions'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import drive from '@adonisjs/drive/services/main'
import sharp from 'sharp'
import { ulid } from 'ulid'
import Asset from '#models/asset'
import BoardScene from '#models/board_scene'
import {
  analysis,
  dangerousMimes,
  imageMimes,
  maxUploadSizeBytes,
  pdfMimes,
  thumbnail,
  type AssetSource,
} from '#config/assets'
import { t } from '#services/i18n'

export type AssetKind = 'image' | 'pdf' | 'link' | 'file'

interface LinkMeta {
  title?: string
  description?: string
  ogImage?: string
}

/** Rozszerzenia wyznaczane z MIME — nigdy z nazwy pliku użytkownika. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Normalizuje MIME przed klasyfikacją. Fallback na `Content-Type` klienta
 * przychodzi w surowej formie nagłówka — może mieć parametry (`; charset=utf-8`),
 * wielkie litery i spacje. Bez tego `image/PNG` albo `image/svg+xml; charset=utf-8`
 * nie trafiłoby do `imageMimes` ani do `dangerousMimes`.
 */
function normalizeMime(mime: string): string {
  const bare = mime.split(';')[0].trim().toLowerCase()
  return MIME_ALIASES[bare] ?? bare
}

/**
 * Kanonikalizacja MIME gubionych przez `file.type/subtype` Adonisa.
 *
 * Adonis składa MIME z dwóch pól i dla SVG daje `type: 'image'`,
 * `subtype: 'svg'` — sufiks `+xml` przepada. Powstałe `image/svg` nie ma
 * żadnego dopasowania w `imageMimes`, więc SVG lądowało jako `kind: 'file'`
 * i WSZYSTKIE gałęzie SVG w kodzie były martwe: brak miniatury, brak
 * renderowania na płótnie, brak wejścia do pipeline'u AI, a w `/raw`
 * nie odpalał się ani `attachment`, ani `CSP` (assets_controller.ts:108).
 */
const MIME_ALIASES: Record<string, string> = {
  'image/svg': 'image/svg+xml',
}

/** Klasyfikuje MIME na rodzaj assetu. Rzuca 422 dla typów zakazanych. */
export function classifyMime(mime: string): 'image' | 'pdf' | 'file' {
  if (imageMimes.includes(mime)) return 'image'
  if (pdfMimes.includes(mime)) return 'pdf'
  if (dangerousMimes.includes(mime)) {
    throw new Exception(t('asset.forbiddenMime', { mime }), {
      status: 422,
      code: 'E_ASSET_MIME_FORBIDDEN',
    })
  }
  return 'file'
}

/** Rozszerzenie pliku do klucza storage. Sanityzowane (bez ścieżek). */
function extForFile(mime: string, clientExtname?: string): string {
  const known = EXT_BY_MIME[mime]
  if (known) return known

  const ext = (clientExtname ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10)
  return ext || 'bin'
}

/**
 * Format raportowany przez `sharp` dla każdego rastrowego MIME, który
 * klasyfikujemy jako `kind: image`.
 */
const SHARP_FORMAT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Weryfikacja „deklaracja MIME vs. zawartość pliku" (hardening z Bramki 2).
 *
 * MIME assetu pochodzi z `file.type/subtype` Adonisa, a ten — gdy magic number
 * nie rozpozna pliku — spada na `Content-Type` przysłany przez klienta.
 * Dało się więc zapisać asset z `mime: image/png`, którego bajty są czymkolwiek
 * (np. HTML-em). Serwowanie takiego pliku jest obecnie zablokowane po stronie
 * nagłówków (`nosniff`, CSP, attachment dla SVG), ale sam wiersz `kind: image`
 * z niedziałającą ścieżką renderowania to śmieć w bazie i mylący stan UI.
 *
 * Dlatego dla typów rastrowych potwierdzamy zawartość przez `sharp.metadata()`,
 * a dla SVG wymagamy, żeby dokument faktycznie zawierał element `<svg>`.
 * Rozjazd deklaracja↔zawartość kończy się czytelnym 422.
 */
async function assertContentMatchesMime(buffer: Buffer, mime: string, filename: string) {
  const reject = (detail: string): never => {
    throw new Exception(t('asset.mismatch', { name: filename, mime, detail }), {
      status: 422,
      code: 'E_ASSET_CONTENT_MISMATCH',
    })
  }

  if (mime === 'image/svg+xml') {
    // SVG nie ma magic number — sprawdzamy, czy to w ogóle dokument SVG.
    const head = buffer.subarray(0, 4096).toString('utf8')
    if (!/<svg[\s/>]/i.test(head)) reject(t('asset.mismatch.noSvg'))
    return
  }

  const expected = SHARP_FORMAT_BY_MIME[mime]
  if (!expected) return

  let format: string | undefined
  try {
    format = (await sharp(buffer).metadata()).format
  } catch {
    reject(t('asset.mismatch.unreadable'))
  }
  if (format !== expected)
    reject(t('asset.mismatch.detected', { format: format ?? t('asset.mismatch.unknown') }))
}

/**
 * Generuje miniatury dla obrazu (raw -> thumb 512px + wariant AI 1568px).
 * Zwraca klucze oraz wymiary. Błędy rzucane są do wywołującego — dla plików,
 * których nie da się zrasteryzować, wywołujący może pominąć miniatury.
 */
async function processImage(buffer: Buffer, baseKey: string) {
  const meta = await sharp(buffer).metadata()
  const thumbKey = `${baseKey}.thumb.webp`
  const analysisKey = `${baseKey}.analysis.webp`

  const [thumbBuffer, analysisBuffer] = await Promise.all([
    sharp(buffer)
      .rotate()
      .resize(thumbnail.maxDimension, thumbnail.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: thumbnail.quality })
      .toBuffer(),
    sharp(buffer)
      .rotate()
      .resize(analysis.maxDimension, analysis.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: analysis.quality })
      .toBuffer(),
  ])

  await drive.use().put(thumbKey, thumbBuffer, { contentType: 'image/webp' })
  await drive.use().put(analysisKey, analysisBuffer, { contentType: 'image/webp' })

  return { thumbKey, analysisKey, width: meta.width ?? null, height: meta.height ?? null }
}

/**
 * Best-effort pobranie metadanych linku (tytuł/opis/og:image). Zwraca `null`
 * przy braku dostępu lub braku metadanych — nie blokuje utworzenia karty.
 */
async function fetchLinkMeta(url: string): Promise<LinkMeta | null> {
  try {
    // Bez SSRF: adresy prywatne/wewnętrzne są odrzucane przy łączeniu.
    const res = await safeFetch(url, { timeoutMs: 3000, maxBytes: 1024 * 1024 })
    if (res.status < 200 || res.status >= 300) return null
    if (!res.contentType.includes('text/html')) return null

    const html = res.text()
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()

    const meta = (prop: string): string | undefined => {
      const attrFirst = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
        'i'
      )
      const m = html.match(attrFirst)
      if (m) return m[1]
      const contentFirst = new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
        'i'
      )
      return html.match(contentFirst)?.[1]
    }

    const result: LinkMeta = {
      title: title || meta('og:title') || undefined,
      description: meta('og:description') || meta('description') || undefined,
      ogImage: meta('og:image') || undefined,
    }
    return result.title || result.description || result.ogImage ? result : null
  } catch {
    return null
  }
}

/** Zapisuje jeden przesłany plik (walidacja + sha256 + dedup + miniatury). */
export async function storeUploadedFile(
  boardId: number,
  file: MultipartFile,
  source: AssetSource
): Promise<Asset> {
  if (!file.isValid || !file.tmpPath) {
    const message = file.errors?.[0]?.message ?? t('asset.readFailed')
    throw new Exception(message, { status: 422, code: 'E_ASSET_INVALID_FILE' })
  }

  if (file.size > maxUploadSizeBytes) {
    throw new Exception(t('asset.tooLarge', { name: file.clientName }), {
      status: 422,
      code: 'E_ASSET_TOO_LARGE',
    })
  }

  const mime = normalizeMime(
    file.type && file.subtype
      ? `${file.type}/${file.subtype}`
      : (file.headers?.['content-type'] ?? 'application/octet-stream')
  )

  const buffer = await readFile(file.tmpPath)
  return storeBuffer(
    boardId,
    { buffer, mime, clientName: file.clientName, extname: file.extname, size: file.size },
    source
  )
}

/**
 * Zapis pliku z bufora (upload albo pobranie z sieci, np. obraz og:image przy
 * imporcie strony): walidacja typu i zawartości, dedup, miniatury.
 */
export async function storeBuffer(
  boardId: number,
  input: { buffer: Buffer; mime: string; clientName: string; extname?: string; size: number },
  source: AssetSource
): Promise<Asset> {
  const { buffer, mime } = input
  const file = { clientName: input.clientName, extname: input.extname, size: input.size }
  if (file.size > maxUploadSizeBytes) {
    throw new Exception(t('asset.tooLarge', { name: file.clientName }), {
      status: 422,
      code: 'E_ASSET_TOO_LARGE',
    })
  }

  // Rzuca 422 dla typów zakazanych (HTML/JS).
  const kind = classifyMime(mime)
  const ext = extForFile(mime, file.extname)

  // Rzuca 422, gdy bajty nie odpowiadają zadeklarowanemu MIME (tylko obrazy).
  if (kind === 'image') {
    await assertContentMatchesMime(buffer, mime, file.clientName)
  }

  const hash = sha256(buffer)

  // Deduplikacja w obrębie tablicy — ten sam sha256 nie dubluje binariów.
  const existing = await Asset.query()
    .where('board_id', boardId)
    .where('sha256', hash)
    .whereNotNull('storage_key')
    .first()
  if (existing) return existing

  const key = `boards/${boardId}/assets/${ulid()}.${ext}`
  await drive.use().put(key, buffer, { contentType: mime, contentLength: buffer.length })

  let thumbKey: string | null = null
  let analysisKey: string | null = null
  let width: number | null = null
  let height: number | null = null

  if (kind === 'image') {
    try {
      const variants = await processImage(buffer, key)
      thumbKey = variants.thumbKey
      analysisKey = variants.analysisKey
      width = variants.width
      height = variants.height
    } catch {
      // Miniatury/wariant AI to optymalizacja — nie blokują zapisu raw (np. PDF).
    }
  }

  return Asset.create({
    boardId,
    kind,
    filename: file.clientName,
    mime,
    size: file.size,
    sha256: hash,
    storageKey: key,
    thumbKey,
    analysisKey,
    width,
    height,
    source,
  })
}

/** Tworzy asset typu link (karta URL z metadanymi og:*, jeśli dostępne). */
export async function storeLink(boardId: number, url: string): Promise<Asset> {
  const meta = await fetchLinkMeta(url)
  return Asset.create({
    boardId,
    kind: 'link',
    filename: url,
    mime: null,
    size: null,
    sha256: null,
    storageKey: null,
    thumbKey: null,
    analysisKey: null,
    source: 'url',
    position: meta ? { link: meta } : null,
  })
}

/** Usuwa pliki (raw + miniatury) z dysku. Nie rzuca przy braku pliku. */
export async function deleteAssetFiles(asset: Asset): Promise<void> {
  const keys = [asset.storageKey, asset.thumbKey, asset.analysisKey].filter(
    (key): key is string => typeof key === 'string' && key.length > 0
  )
  await Promise.all(
    keys.map((key) =>
      drive
        .use()
        .delete(key)
        .catch(() => {})
    )
  )
}

/** Serializuje asset do kształtu odpowiedzi API. */
export function serializeAsset(asset: Asset) {
  return {
    id: asset.id,
    boardId: asset.boardId,
    kind: asset.kind,
    filename: asset.filename,
    mime: asset.mime,
    size: asset.size,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    source: asset.source,
    userNote: asset.userNote,
    usage: asset.usage,
    inbox: Boolean(asset.inbox),
    submittedBy: asset.submittedBy ?? null,
    linkMeta:
      asset.kind === 'link' ? ((asset.position as { link?: LinkMeta } | null)?.link ?? null) : null,
    createdAt: asset.createdAt?.toISO() ?? null,
    urls: {
      raw: `/api/assets/${asset.id}/raw`,
      thumb: asset.thumbKey ? `/api/assets/${asset.id}/thumb` : null,
      content: `/api/assets/${asset.id}/content`,
    },
  }
}

/** Identyfikatory assetów, do których odwołuje się dokument sceny (obrazy, karty linków). */
export function referencedAssetIds(document: unknown): Set<number> {
  const ids = new Set<number>()
  const elements = (document as { elements?: unknown } | null)?.elements
  if (!Array.isArray(elements)) return ids
  for (const el of elements) {
    const raw = (el as { assetId?: unknown } | null)?.assetId
    const id = Number.parseInt(String(raw ?? ''), 10)
    if (Number.isFinite(id) && id > 0) ids.add(id)
  }
  return ids
}

/**
 * Usuwa assety tablicy, których nie ma już na płótnie (element usunięty), razem
 * z plikami. Wołane przy otwarciu tablicy — wtedy historia cofania z poprzedniej
 * sesji już nie istnieje, więc usunięcia nie da się cofnąć i asset jest sierotą.
 * Bez sceny nie usuwa niczego (brak danych ≠ pusta tablica).
 */
export async function pruneOrphanAssets(boardId: number): Promise<number[]> {
  const scene = await BoardScene.query().where('board_id', boardId).first()
  if (!scene) return []
  const referenced = referencedAssetIds(scene.document)
  // Materiały od klienta (skrzynka portalu) czekają na właściciela — nie są sierotami.
  // Świeże materiały (< 15 min) mogą jeszcze czekać na zapis sceny u innego
  // uczestnika tablicy albo w drugiej karcie — nie ruszamy ich.
  const fresh = DateTime.utc().minus({ minutes: 15 })
  const orphans = (await Asset.query().where('board_id', boardId).where('inbox', false)).filter(
    (a) => !referenced.has(a.id) && (!a.createdAt || a.createdAt < fresh)
  )
  for (const asset of orphans) {
    await deleteAssetFiles(asset)
    await asset.delete()
  }
  return orphans.map((a) => a.id)
}
