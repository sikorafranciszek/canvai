/**
 * Klient HTTP dla API assetów i sceny (M2b). Jedyny moduł, który robi `fetch`
 * / `XMLHttpRequest` — reszta UI woła te funkcje (i sesję w `session.ts`).
 */
import type { SceneDocument } from '@shared/scene'
import { AutosaveConflictError } from '@shared/autosave'
import type { UploadSource } from '@shared/upload-state'
import { translate } from '~/i18n'
import { HttpError, httpError } from '~/lib/errors'
import type { AssetUsage } from '@shared/asset-usage'

export interface SceneResponse {
  version: number
  document: SceneDocument
  appState: Record<string, unknown>
}

export interface AssetDto {
  id: string
  boardId: number
  kind: 'image' | 'pdf' | 'link' | 'text' | 'file'
  filename: string
  mime: string | null
  size: number | null
  sha256: string | null
  width: number | null
  height: number | null
  source: string | null
  userNote: string | null
  /** Jak użyć materiału w DESIGN.md (rola i aspekty). */
  usage?: AssetUsage
  /** Materiał od klienta (portal) czekający na umieszczenie na płótnie. */
  inbox?: boolean
  submittedBy?: string | null
  linkMeta: { title?: string; description?: string; ogImage?: string } | null
  createdAt: string | null
  urls: { raw: string; thumb: string | null; content: string }
}

/** Czyta cookie (XSRF-TOKEN do CSRF Shield). Odpowiednik zachowania axiosa. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

/** Nagłówek CSRF dla zapytań mutujących (Shield: enableXsrfCookie). */
/**
 * Identyfikator tej karty przeglądarki — serwer nie odsyła nam naszych własnych
 * zdarzeń na żywo (zmiana sceny, materiałów, komentarzy).
 */
export const CLIENT_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`

export function csrfHeaders(): Record<string, string> {
  const token = readCookie('XSRF-TOKEN')
  return token ? { 'X-XSRF-TOKEN': token, 'X-Client-Id': CLIENT_ID } : { 'X-Client-Id': CLIENT_ID }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

export async function getScene(boardId: number): Promise<SceneResponse> {
  const res = await fetch(`/api/boards/${boardId}/scene`, { credentials: 'same-origin' })
  if (!res.ok) throw await httpError(res, translate('api.sceneLoad'))
  const body = await parseJson<{ data: SceneResponse }>(res)
  return body.data
}

export async function putScene(
  boardId: number,
  payload: { version: number; document: SceneDocument; appState: Record<string, unknown> | null },
  opts: { keepalive?: boolean } = {}
): Promise<number> {
  const res = await fetch(`/api/boards/${boardId}/scene`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    keepalive: opts.keepalive ?? false,
  })

  if (res.status === 409) {
    const body = await parseJson<{ currentVersion?: number }>(res).catch(
      () => ({}) as { currentVersion?: number }
    )
    throw new AutosaveConflictError(body.currentVersion ?? payload.version)
  }
  if (!res.ok) throw await httpError(res, translate('api.sceneSave'))

  const body = await parseJson<{ data: SceneResponse }>(res)
  return body.data.version
}

export async function listAssets(boardId: number): Promise<AssetDto[]> {
  const res = await fetch(`/api/boards/${boardId}/assets`, { credentials: 'same-origin' })
  if (!res.ok) throw await httpError(res, translate('api.assetsLoad'))
  const body = await parseJson<{ data: AssetDto[] }>(res)
  return body.data
}

export interface UploadProgressEvent {
  loaded: number
  total: number
}

function parseUploadError(xhr: XMLHttpRequest): Error {
  let message = translate('api.uploadFailed')
  let fromServer = false
  let code: string | null = null
  try {
    const body = JSON.parse(xhr.responseText)
    if (typeof body === 'string' && body) message = body
    else if (typeof body?.message === 'string') message = body.message
    else if (Array.isArray(body?.errors) && typeof body.errors[0]?.message === 'string') {
      message = body.errors[0].message
    }
    fromServer = message !== translate('api.uploadFailed')
    if (typeof body?.code === 'string') code = body.code
  } catch {
    // odpowiedź nie jest JSON — zostaje komunikat domyślny
  }
  return new HttpError(message, xhr.status, code, fromServer)
}

/**
 * Wysyła wiele plików jednym multipart POST (`files[]`). Zwraca assety w tej
 * samej kolejności co pliki. Postęp jest zbiorczy (XHR nie daje per-plik).
 */
export function uploadFiles(
  boardId: number,
  files: File[],
  source: UploadSource,
  onProgress: (fileIndex: number, event: UploadProgressEvent) => void
): Promise<AssetDto[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('source', source)
    for (const file of files) form.append('files', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/boards/${boardId}/assets`)
    xhr.withCredentials = true
    // JSON z powodem odrzucenia (np. „plik nie jest PNG”), a nie strona błędu.
    xhr.setRequestHeader('Accept', 'application/json')
    const token = readCookie('XSRF-TOKEN')
    if (token) xhr.setRequestHeader('X-XSRF-TOKEN', token)

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      for (let i = 0; i < files.length; i++) {
        onProgress(i, { loaded: e.loaded, total: e.total })
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText)
          resolve((body.data ?? []) as AssetDto[])
        } catch {
          reject(new Error(translate('api.badResponse')))
        }
      } else {
        reject(parseUploadError(xhr))
      }
    }
    xhr.onerror = () => reject(new Error(translate('api.noConnection')))
    xhr.onabort = () => reject(new Error(translate('api.uploadAborted')))

    xhr.send(form)
  })
}

/** Usuwa na serwerze assety, których nie ma już na płótnie. Zwraca ich id. */
export async function pruneAssets(boardId: number): Promise<number[]> {
  const res = await fetch(`/api/boards/${boardId}/assets/prune`, {
    method: 'POST',
    headers: csrfHeaders(),
    credentials: 'same-origin',
  })
  if (!res.ok) return []
  const body = await parseJson<{ data?: { removed?: number[] } }>(res)
  return body.data?.removed ?? []
}

export async function createLinkAsset(boardId: number, url: string): Promise<AssetDto> {
  const res = await fetch(`/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ source: 'url', url }),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw await httpError(res, translate('api.linkFailed'))
  }
  const body = await parseJson<{ data: AssetDto[] }>(res)
  return body.data[0]
}

export async function updateAssetNote(assetId: string, note: string): Promise<AssetDto> {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ note }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('api.noteFailed'))
  const body = await parseJson<{ data: AssetDto }>(res)
  return body.data
}

/** Rola i aspekty materiału (co AI ma z niego wziąć do DESIGN.md). */
export async function updateAssetUsage(assetId: string, usage: AssetUsage): Promise<AssetDto> {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ usage }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('api.noteFailed'))
  return (await parseJson<{ data: AssetDto }>(res)).data
}

export interface SiteImportResult {
  assets: AssetDto[]
  note: string
  summary: { host: string; colors: number; fonts: string[] }
}

/** Import strony z URL (karta linku, obraz og:image, notatka ze stylem). */
export async function importSite(boardId: number, url: string): Promise<SiteImportResult> {
  const res = await fetch(`/api/boards/${boardId}/import-site`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw await httpError(res, translate('siteImport.failedShort'))
  return ((await res.json()) as { data: SiteImportResult }).data
}

export interface FigmaImportResult {
  assets: AssetDto[]
  note: string
  summary: { file: string; frames: number; colors: number; fonts: string[] }
}

export class FigmaImportError extends Error {
  constructor(
    message: string,
    public readonly code: string | null
  ) {
    super(message)
  }
}

/** Import z Figmy: ramki jako obrazy + notatka z dokładnymi stylami. */
export async function importFigma(
  boardId: number,
  input: { url: string; token?: string; remember?: boolean }
): Promise<FigmaImportResult> {
  const res = await fetch(`/api/boards/${boardId}/import-figma`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string }
    throw new FigmaImportError(body.message ?? translate('figma.failedShort'), body.code ?? null)
  }
  return ((await res.json()) as { data: FigmaImportResult }).data
}

export async function figmaStatus(): Promise<{ connected: boolean }> {
  const res = await fetch('/api/figma', { credentials: 'same-origin' })
  if (!res.ok) return { connected: false }
  return ((await res.json()) as { data: { connected: boolean } }).data
}

export async function setFigmaToken(token: string | null): Promise<{ connected: boolean }> {
  const res = await fetch('/api/figma', {
    method: token ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
    body: token ? JSON.stringify({ token }) : undefined,
  })
  if (!res.ok) throw await httpError(res, translate('figma.failedShort'))
  return ((await res.json()) as { data: { connected: boolean } }).data
}

/** Materiał od klienta trafił na płótno — zdejmij go ze skrzynki. */
export async function acceptInboxAsset(assetId: string): Promise<void> {
  await fetch(`/api/assets/${assetId}/accept`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
  })
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'DELETE',
    headers: csrfHeaders(),
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 404) throw await httpError(res, translate('api.deleteFailed'))
}

// ---------------------------------------------------------------------------
// DESIGN.md (M3)
// ---------------------------------------------------------------------------

export type DesignDocStatus = 'queued' | 'running' | 'ready' | 'failed'

export interface DesignDocProgress {
  stage: 'analyze' | 'compose' | 'render'
  done: number
  total: number
}

export interface DesignDocDto {
  id: number
  boardId: number
  version: number
  status: DesignDocStatus
  error: string | null
  usage: {
    assets: number
    analyzed: number
    cached: number
    tokensIn: number
    tokensOut: number
    durationMs: number
  } | null
  sources: { assetId: number; filename: string; kind: string; sections: string[] }[] | null
  creditsCharged?: number | null
  proMode?: boolean
  hasSpec?: boolean
  createdAt: string | null
  generatedAt: string | null
  jobId: number | null
  progress: DesignDocProgress | null
  contentMd?: string | null
  editedFromVersion?: number | null
  instruction?: string | null
  revisedSection?: string | null
  quality?: QualityReport
  tokens?: DocTokens
}

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

export interface QualityReport {
  score: number
  grade: 'excellent' | 'good' | 'fair' | 'weak'
  grounded: number
  total: number
  assumed: { kind: 'color' | 'font' | 'component' | 'spacing'; name: string }[]
  gaps: {
    id: string
    severity: 'high' | 'medium' | 'low'
    params?: Record<string, string | number>
  }[]
  contrast: {
    text: { name: string; hex: string; token: string }
    background: { name: string; hex: string }
    ratio: number
    level: WcagLevel
    suggestion: string | null
  }[]
}

export interface DocTokens {
  colors: {
    token: string
    name: string
    hex: string
    role: string
    assumed: boolean
    confirmed: boolean
  }[]
  families: { token: string; name: string; role: string; assumed: boolean; confirmed: boolean }[]
  radii: { name: string; value: string }[]
}

export interface DocEdits {
  colors?: { token: string; hex?: string; confirm?: boolean }[]
  families?: { token: string; name?: string; confirm?: boolean }[]
  radii?: { name: string; value: string }[]
}

/** Poprawione tokeny → nowa wersja DESIGN.md (bez AI i kredytów). */
export async function editDesignDoc(
  boardId: number,
  version: number,
  edits: DocEdits
): Promise<DesignDocDto> {
  const res = await fetch(`/api/boards/${boardId}/design-doc/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ version, ...edits }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('tokens.saveFailed'))
  return (await parseJson<{ data: DesignDocDto }>(res)).data
}

/** Anuluje generację w toku (UX-11); zwraca anulowaną wersję. */
export async function cancelDesignDoc(boardId: number): Promise<DesignDocDto> {
  const res = await fetch(`/api/boards/${boardId}/design-doc/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('doc.cancelFailed'))
  return (await parseJson<{ data: DesignDocDto }>(res)).data
}

export class DesignDocRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly doc: DesignDocDto | null = null
  ) {
    super(message)
  }
}

export type GenerateDesignDocResult =
  { kind: 'queued'; doc: DesignDocDto } | { kind: 'reused'; doc: DesignDocDto }

export async function generateDesignDoc(
  boardId: number,
  opts: { force?: boolean; proMode?: boolean } = {}
): Promise<GenerateDesignDocResult> {
  const res = await fetch(`/api/boards/${boardId}/design-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ force: opts.force ?? false, proMode: opts.proMode ?? false }),
    credentials: 'same-origin',
  })
  const body = await parseJson<{
    data?: { doc: DesignDocDto; reused: boolean } | DesignDocDto
    message?: string
    code?: string
  }>(res).catch(() => ({}) as { data?: undefined; message?: string; code?: string })

  if (res.status === 202 || res.status === 200) {
    const data = body.data as { doc: DesignDocDto; reused: boolean }
    return { kind: data.reused ? 'reused' : 'queued', doc: data.doc }
  }
  const inProgress = res.status === 409 ? ((body.data as DesignDocDto | undefined) ?? null) : null
  throw new DesignDocRequestError(
    body.message ?? translate('api.generateFailed'),
    res.status,
    body.code ?? null,
    inProgress
  )
}

export const REVISABLE_SECTIONS = [
  'colors',
  'typography',
  'layout',
  'components',
  'screens',
  'voice',
  'rules',
] as const
export type RevisableSection = (typeof REVISABLE_SECTIONS)[number]

/**
 * Poprawka poleceniem albo regeneracja jednej sekcji (FEAT-2) — nowa wersja
 * na bazie `version`. Błędy jak przy generacji (409 z trwającą wersją itd.).
 */
export async function reviseDesignDoc(
  boardId: number,
  input: { version: number; instruction: string; section?: RevisableSection }
): Promise<DesignDocDto> {
  const res = await fetch(`/api/boards/${boardId}/design-doc/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(input),
    credentials: 'same-origin',
  })
  const body = await parseJson<{
    data?: { doc: DesignDocDto } | DesignDocDto
    message?: string
    code?: string
  }>(res).catch(() => ({}) as { data?: undefined; message?: string; code?: string })
  if (res.status === 202) return (body.data as { doc: DesignDocDto }).doc
  const inProgress = res.status === 409 ? ((body.data as DesignDocDto | undefined) ?? null) : null
  throw new DesignDocRequestError(
    body.message ?? translate('revise.failed'),
    res.status,
    body.code ?? null,
    inProgress
  )
}

export async function getDesignDoc(
  boardId: number,
  version?: number
): Promise<DesignDocDto | null> {
  const qs = version ? `?version=${version}` : ''
  const res = await fetch(`/api/boards/${boardId}/design-doc${qs}`, { credentials: 'same-origin' })
  if (res.status === 404) return null
  if (!res.ok) throw await httpError(res, translate('api.docLoad'))
  const body = await parseJson<{ data: DesignDocDto | null }>(res)
  return body.data
}

/** Zmiany między wersjami (FEAT-1) — kształt jak `SpecChanges` na serwerze. */
export interface SpecChangesDto {
  colors: ChangeGroupDto
  fonts: ChangeGroupDto
  radii: ChangeGroupDto
  spacing: ChangeGroupDto
  components: { added: string[]; removed: string[] }
  screens: { added: string[]; removed: string[] }
  reasons: ChangeReasonDto[]
  empty: boolean
}
export interface ChangeGroupDto {
  added: { name: string; value: string }[]
  removed: { name: string; value: string }[]
  changed: { name: string; from: string; to: string }[]
}
export type ChangeReasonDto =
  | { type: 'asset_added'; assetId: number; filename: string; usage?: AssetUsage }
  | { type: 'asset_removed'; assetId: number; filename: string }
  | { type: 'usage_changed'; assetId: number; filename: string; from?: AssetUsage; to?: AssetUsage }
  | { type: 'edited' }
  | { type: 'command'; instruction: string; section: string | null }
  | { type: 'pro_mode'; on: boolean }
  | { type: 'prompt_version'; from: string; to: string }

export async function getDesignDocChanges(
  boardId: number,
  version: number,
  from?: number
): Promise<{ from: number; to: number; changes: SpecChangesDto } | null> {
  const qs = new URLSearchParams({
    version: String(version),
    ...(from ? { from: String(from) } : {}),
  })
  const res = await fetch(`/api/boards/${boardId}/design-doc/changes?${qs}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw await httpError(res, translate('api.docLoad'))
  return (
    await parseJson<{ data: { from: number; to: number; changes: SpecChangesDto } | null }>(res)
  ).data
}

export async function listDesignDocs(
  boardId: number
): Promise<{ versions: DesignDocDto[]; hiddenVersions: number }> {
  const res = await fetch(`/api/boards/${boardId}/design-docs`, { credentials: 'same-origin' })
  if (!res.ok) throw await httpError(res, translate('api.docsLoad'))
  const body = await parseJson<{ data: DesignDocDto[]; meta?: { hiddenVersions?: number } }>(res)
  return { versions: body.data, hiddenVersions: body.meta?.hiddenVersions ?? 0 }
}

export function designDocDownloadUrl(boardId: number, version?: number): string {
  return `/api/boards/${boardId}/design-doc/download${version ? `?version=${version}` : ''}`
}
