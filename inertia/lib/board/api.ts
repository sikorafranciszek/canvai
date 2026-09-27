/**
 * Klient HTTP dla API assetów i sceny (M2b). Jedyny moduł, który robi `fetch`
 * / `XMLHttpRequest` — reszta UI woła te funkcje (i sesję w `session.ts`).
 */
import type { SceneDocument } from '@shared/scene'
import { AutosaveConflictError } from '@shared/autosave'
import type { UploadSource } from '@shared/upload-state'

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
  if (!res.ok) throw new Error(`Nie udało się wczytać sceny (${res.status})`)
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
    const body = await parseJson<{ currentVersion?: number }>(res).catch(() => ({} as { currentVersion?: number }))
    throw new AutosaveConflictError(body.currentVersion ?? payload.version)
  }
  if (!res.ok) throw new Error(`Nie udało się zapisać sceny (${res.status})`)

  const body = await parseJson<{ data: SceneResponse }>(res)
  return body.data.version
}

export async function listAssets(boardId: number): Promise<AssetDto[]> {
  const res = await fetch(`/api/boards/${boardId}/assets`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Nie udało się pobrać assetów (${res.status})`)
  const body = await parseJson<{ data: AssetDto[] }>(res)
  return body.data
}

export interface UploadProgressEvent {
  loaded: number
  total: number
}

function parseUploadError(xhr: XMLHttpRequest): Error {
  let message = `Upload nie powiódł się (${xhr.status})`
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
          reject(new Error('Niepoprawna odpowiedź serwera'))
        }
      } else {
        reject(parseUploadError(xhr))
      }
    }
    xhr.onerror = () => reject(new Error('Brak połączenia z serwerem'))
    xhr.onabort = () => reject(new Error('Upload przerwany'))

    xhr.send(form)
  })
}

export async function createLinkAsset(boardId: number, url: string): Promise<AssetDto> {
  const res = await fetch(`/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ source: 'url', url }),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, `Nie udało się dodać linku (${res.status})`))
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
  if (!res.ok) throw new Error(`Nie udało się zapisać notatki (${res.status})`)
  const body = await parseJson<{ data: AssetDto }>(res)
  return body.data
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'DELETE',
    headers: csrfHeaders(),
    credentials: 'same-origin',
  })
  if (!res.ok && res.status !== 404) throw new Error(`Nie udało się usunąć assetu (${res.status})`)
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
