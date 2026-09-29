/**
 * Klient HTTP dla API assetów i sceny (M2b). Jedyny moduł, który robi `fetch`
 * / `XMLHttpRequest` — reszta UI woła te funkcje (i sesję w `session.ts`).
 */
import type { SceneDocument } from '@shared/scene'
import { AutosaveConflictError } from '@shared/autosave'
import type { UploadSource } from '@shared/upload-state'
import { translate } from '~/i18n'

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
export function csrfHeaders(): Record<string, string> {
  const token = readCookie('XSRF-TOKEN')
  return token ? { 'X-XSRF-TOKEN': token } : {}
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

export async function getScene(boardId: number): Promise<SceneResponse> {
  const res = await fetch(`/api/boards/${boardId}/scene`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(translate('api.sceneLoad', { status: res.status }))
  const body = await parseJson<{ data: SceneResponse }>(res)
  return body.data
}

export async function putScene(
  boardId: number,
  payload: { version: number; document: SceneDocument; appState: Record<string, unknown> },
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
  if (!res.ok) throw new Error(translate('api.sceneSave', { status: res.status }))

  const body = await parseJson<{ data: SceneResponse }>(res)
  return body.data.version
}

export async function listAssets(boardId: number): Promise<AssetDto[]> {
  const res = await fetch(`/api/boards/${boardId}/assets`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(translate('api.assetsLoad', { status: res.status }))
  const body = await parseJson<{ data: AssetDto[] }>(res)
  return body.data
}

export interface UploadProgressEvent {
  loaded: number
  total: number
}

function parseUploadError(xhr: XMLHttpRequest): Error {
  let message = translate('api.uploadFailed', { status: xhr.status })
  try {
    const body = JSON.parse(xhr.responseText)
    if (typeof body === 'string' && body) message = body
    else if (typeof body?.message === 'string') message = body.message
    else if (Array.isArray(body?.errors) && typeof body.errors[0]?.message === 'string') {
      message = body.errors[0].message
    }
  } catch {
    // odpowiedź nie jest JSON — zostaje komunikat domyślny
  }
  return new Error(message)
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
    throw new Error(await extractErrorMessage(res, translate('api.linkFailed', { status: res.status })))
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
  if (!res.ok) throw new Error(translate('api.noteFailed', { status: res.status }))
  const body = await parseJson<{ data: AssetDto }>(res)
  return body.data
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'DELETE',
    headers: csrfHeaders(),
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 404) throw new Error(translate('api.deleteFailed', { status: res.status }))
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await parseJson<{ message?: string; errors?: { message?: string }[] }>(res)
    if (typeof body?.message === 'string') return body.message
    if (Array.isArray(body?.errors) && typeof body.errors[0]?.message === 'string') {
      return body.errors[0].message
    }
  } catch {
    // ignore
  }
  return fallback
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
  model: string | null
  promptVersion: string | null
  usage: {
    assets: number
    analyzed: number
    cached: number
    tokensIn: number
    tokensOut: number
    durationMs: number
  } | null
  sources: { assetId: number; filename: string; kind: string; sections: string[] }[] | null
  createdAt: string | null
  generatedAt: string | null
  jobId: number | null
  progress: DesignDocProgress | null
  contentMd?: string | null
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
  opts: { force?: boolean } = {}
): Promise<GenerateDesignDocResult> {
  const res = await fetch(`/api/boards/${boardId}/design-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ force: opts.force ?? false }),
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
    body.message ?? translate('api.generateFailed', { status: res.status }),
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
  if (!res.ok) throw new Error(translate('api.docLoad', { status: res.status }))
  const body = await parseJson<{ data: DesignDocDto | null }>(res)
  return body.data
}

export async function listDesignDocs(boardId: number): Promise<DesignDocDto[]> {
  const res = await fetch(`/api/boards/${boardId}/design-docs`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(translate('api.docsLoad', { status: res.status }))
  const body = await parseJson<{ data: DesignDocDto[] }>(res)
  return body.data
}

export function designDocDownloadUrl(boardId: number, version?: number): string {
  return `/api/boards/${boardId}/design-doc/download${version ? `?version=${version}` : ''}`
}
