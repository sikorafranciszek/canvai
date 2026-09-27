/**
 * Cykl życia uploadu assetu — czysta logika (bez XHR/Reacta), testowana
 * w `tests/unit/upload_state.spec.ts`.
 *
 * Kluczowa własność: placeholder (pending upload) NIE jest elementem sceny —
 * żyje osobno, dopóki serwer nie potwierdzi zapisu. Dopiero po sukcesie
 * powstaje element `image`. Przy błędzie placeholder znika bez śladu
 * (rollback — brak sieroty ani na płótnie, ani w panelu).
 */
import type { SceneImageElement } from './scene.js'

export type UploadSource = 'paste' | 'drop' | 'upload' | 'url'

export type PendingUploadStatus = 'uploading' | 'done' | 'error'

/** Asset po stronie klienta — tylko to, co potrzebne do elementu sceny. */
export interface ResolvedUploadAsset {
  id: string
  width: number | null
  height: number | null
}

export interface PendingUpload {
  /** Identyfikator placeholdera (NIE jest to id elementu sceny). */
  id: string
  source: UploadSource
  filename: string
  x: number
  y: number
  width: number
  height: number
  /** 0..1. */
  progress: number
  status: PendingUploadStatus
  error: string | null
  asset: ResolvedUploadAsset | null
}

const DEFAULT_PLACEHOLDER_SIZE = { width: 240, height: 160 } as const

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function createPendingUpload(input: {
  id: string
  source: UploadSource
  filename: string
  x: number
  y: number
}): PendingUpload {
  return {
    id: input.id,
    source: input.source,
    filename: input.filename,
    x: input.x,
    y: input.y,
    width: DEFAULT_PLACEHOLDER_SIZE.width,
    height: DEFAULT_PLACEHOLDER_SIZE.height,
    progress: 0,
    status: 'uploading',
    error: null,
    asset: null,
  }
}

export function setUploadProgress(upload: PendingUpload, progress: number): PendingUpload {
  return { ...upload, progress: clamp01(progress) }
}

export function completeUpload(upload: PendingUpload, asset: ResolvedUploadAsset): PendingUpload {
  return {
    ...upload,
    status: 'done',
    progress: 1,
    asset,
    width: asset.width ?? upload.width,
    height: asset.height ?? upload.height,
    error: null,
  }
}

export function failUpload(upload: PendingUpload, error: string): PendingUpload {
  return { ...upload, status: 'error', error }
}

/** Buduje element `image` sceny z zakończonego uploadu (albo null). */
export function uploadToImageElement(upload: PendingUpload, elementId: string): SceneImageElement | null {
  if (upload.status !== 'done' || !upload.asset) return null
  return {
    id: elementId,
    type: 'image',
    assetId: upload.asset.id,
    x: upload.x,
    y: upload.y,
    rotation: 0,
    opacity: 1,
    width: upload.width,
    height: upload.height,
  }
}

export interface UploadResolution {
  pendingUploads: PendingUpload[]
  addedElement: SceneImageElement | null
  error: string | null
}

/**
 * Rozstrzyga wynik uploadu: usuwa placeholder z listy i (przy sukcesie)
 * zwraca element `image` do dodania na scenę. Przy błędzie NIE tworzy
 * elementu — to jest rollback nieudanego uploadu.
 */
export function resolveUploadResult(
  pending: PendingUpload[],
  uploadId: string,
  result: { ok: true; asset: ResolvedUploadAsset; elementId: string } | { ok: false; error: string }
): UploadResolution {
  const target = pending.find((u) => u.id === uploadId)
  const rest = pending.filter((u) => u.id !== uploadId)

  if (!target) {
    return { pendingUploads: rest, addedElement: null, error: null }
  }

  if (result.ok) {
    const done = completeUpload(target, result.asset)
    return { pendingUploads: rest, addedElement: uploadToImageElement(done, result.elementId), error: null }
  }

  return { pendingUploads: rest, addedElement: null, error: result.error }
}
