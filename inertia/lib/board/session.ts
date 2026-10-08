/**
 * Sesja tablicy — łączy silnik płótna (scene store) z backendem (API).
 *
 * Odpowiada za: wczytanie sceny przy mount, autosave z debounce, obsługę
 * konfliktu 409, upload plików (paste/drop/upload), karty linków i notatki
 * tekstowe, oraz listę assetów w panelu bocznym.
 *
 * Czysta logika (autosave, cykl uploadu) żyje w `shared/` i jest testowana
 * jednostkowo; tutaj jest tylko spięcie z fetch/XHR i zustand.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { AutosaveEngine, AutosaveConflictError, type SaveStatus } from '@shared/autosave'
import {
  createPendingUpload,
  resolveUploadResult,
  type PendingUpload,
  type UploadSource,
} from '@shared/upload-state'
import { validateClientFile, type ClientFileRejectReason } from '@shared/asset-utils'
import { createElementId } from '@shared/scene-ops'
import type { SceneDocument, SceneElement, SceneStickyElement } from '@shared/scene'
import { useSceneStore, DEFAULT_CAMERA, type Camera } from '~/lib/scene/store'
import { getElementBounds } from '~/lib/scene/geometry'
import {
  createLinkAsset,
  deleteAsset as apiDeleteAsset,
  getScene,
  listAssets,
  putScene,
  updateAssetNote as apiUpdateNote,
  uploadFiles,
  type AssetDto,
  pruneAssets,
  acceptInboxAsset,
  importSite as apiImportSite,
  importFigma as apiImportFigma,
  updateAssetUsage as apiUpdateUsage,
  type FigmaImportResult,
} from './api'
import { DEFAULTS } from '~/lib/scene/palette'
import { hasLocalChanges, mergeScenes } from '@shared/scene-merge'
import type { AssetUsage } from '@shared/asset-usage'
import { translate } from '~/i18n'

export type BoardSaveStatus = SaveStatus | 'dirty' | 'loading'

/** Szerokość panelu assetów + wysokość headera/toolbara — do wyśrodkowania. */
const PANEL_WIDTH = 304
const CHROME_HEIGHT = 100

/** Dłuższa krawędź obrazu wstawianego na płótno (px sceny) i odstęp między obrazami. */
const MAX_IMAGE_EDGE = 960
const IMAGE_GAP = 48

interface BoardState {
  boardId: number | null
  initialized: boolean
  /** Rola „podgląd”: płótno tylko do odczytu, bez zapisu sceny. */
  readOnly: boolean
  version: number
  saveStatus: BoardSaveStatus
  assets: AssetDto[]
  assetsLoading: boolean
  pendingUploads: PendingUpload[]

  init: (boardId: number, opts?: { readOnly?: boolean }) => Promise<void>
  /** Inny uczestnik zapisał scenę — dociągnij i scal z lokalnymi zmianami. */
  pullRemote: (version: number) => Promise<void>
  dispose: () => void
  refreshAssets: () => Promise<void>
  saveNow: (opts?: { keepalive?: boolean }) => Promise<void>
  uploadFiles: (
    files: File[],
    source: UploadSource,
    point: { x: number; y: number }
  ) => Promise<void>
  addLink: (url: string, point: { x: number; y: number }) => Promise<void>
  addTextNote: (text: string, point: { x: number; y: number }) => void
  updateNote: (assetId: string, note: string) => Promise<void>
  /** Rola i aspekty materiału (optymistycznie, z wycofaniem przy błędzie). */
  updateUsage: (assetId: string, usage: AssetUsage) => Promise<void>
  deleteAsset: (assetId: string) => Promise<void>
  centerOnAsset: (assetId: string) => void
  /** Wstawia notatkę brand kitu (dla AI) obok zawartości płótna i ją pokazuje. */
  addBrandKitNote: (text: string) => void
  /** Umieszcza materiały od klienta (skrzynka portalu) obok zawartości płótna. */
  placeInboxAssets: (assetIds: string[]) => Promise<void>
  /** Import strony z URL: link + obraz + notatka ze stylem na płótnie. */
  importSite: (url: string) => Promise<boolean>
  /** Import z Figmy: ramki + notatka z dokładnymi stylami. Rzuca błąd (dialog go pokazuje). */
  importFigma: (input: {
    url: string
    token?: string
    remember?: boolean
  }) => Promise<FigmaImportResult>
}

// Silnik autosave i subskrypcja żyją poza store'em (nie są serializowalne
// i nie powinny wywoływać re-renderów).
let engine: AutosaveEngine<SceneDocument, Record<string, unknown> | null> | null = null
let unsubscribeScene: (() => void) | null = null
let lastDocument: SceneDocument | null = null
let lastCamera: Camera = DEFAULT_CAMERA
// Ostatnia wersja dokumentu zsynchronizowana z serwerem — baza scalania trójstronnego.
let syncedDocument: SceneDocument | null = null
// Zdalna wersja czekająca na koniec gestu (przeciąganie, rysowanie).
let deferredPull: number | null = null
let pointerDown = false
// Token kolejności init — unieważnia starsze (np. StrictMode podwójny mount).
let initSeq = 0

export const useBoardStore = create<BoardState>()((set, get) => ({
  boardId: null,
  initialized: false,
  readOnly: false,
  version: 0,
  saveStatus: 'idle',
  assets: [],
  assetsLoading: false,
  pendingUploads: [],

  async init(boardId, opts) {
    if (get().boardId === boardId && get().initialized) return
    get().dispose()

    const seq = ++initSeq
    const readOnly = Boolean(opts?.readOnly)
    set({
      boardId,
      readOnly,
      initialized: false,
      version: 0,
      saveStatus: 'loading',
      assets: [],
      pendingUploads: [],
    })
    useSceneStore.getState().reset()

    try {
      const { version, document, appState } = await getScene(boardId)
      // Nowszy init/dispose wygrał — ten wczytuje nieaktualną tablicę.
      if (seq !== initSeq) return
      useSceneStore.getState().loadDocument(document)
      // Kamera jest osobista (DAT-4): ostatni widok tego użytkownika, a przy
      // pierwszym otwarciu — widok startowy zapisany w tablicy (szablon, przykład).
      useSceneStore.getState().setCamera(loadCamera(boardId) ?? cameraFromAppState(appState))

      lastDocument = document
      lastCamera = useSceneStore.getState().camera
      syncedDocument = document

      engine = new AutosaveEngine<SceneDocument, Record<string, unknown> | null>(
        {
          debounceMs: 1000,
          save: ({ version, document, appState }) =>
            putScene(boardId, { version, document, appState }),
          reload: async () => {
            const fresh = await getScene(boardId)
            return { version: fresh.version, document: fresh.document, appState: fresh.appState }
          },
          onStatus: (status) => set({ saveStatus: status }),
          // Konflikt = ktoś inny zapisał w międzyczasie: scalamy zamiast nadpisywać.
          onConflict: () => {},
          rebase: (fresh, pending) => {
            const local = useSceneStore.getState().document
            const merged = mergeScenes(syncedDocument ?? fresh.document, local, fresh.document)
            syncedDocument = fresh.document
            if (merged !== local) {
              lastDocument = merged
              useSceneStore.getState().applyRemoteDocument(merged)
            }
            return { document: merged, appState: pending.appState }
          },
          onSaved: (payload) => {
            syncedDocument = payload.document
          },
        },
        version
      )

      unsubscribeScene = useSceneStore.subscribe((state) => {
        if (get().readOnly) {
          lastDocument = state.document
          lastCamera = state.camera
          return
        }
        if (state.camera !== lastCamera) {
          lastCamera = state.camera
          saveCamera(boardId, state.camera)
        }
        // Tylko zmiana treści jest zapisem sceny — ruch kamery nie podbija wersji.
        if (state.document !== lastDocument) {
          lastDocument = state.document
          engine?.schedule(state.document, null)
          set({ saveStatus: 'dirty' })
        }
      })

      set({ initialized: true, version, saveStatus: 'idle' })
      // Materiały usunięte z płótna w poprzedniej sesji nie mają już historii
      // cofania — sprzątamy je na serwerze, zanim pobierzemy listę.
      await pruneAssets(boardId).catch(() => [])
      await get().refreshAssets()
    } catch (error) {
      set({ saveStatus: 'error' })
      toast.error(error instanceof Error ? error.message : translate('session.loadFailed'))
    }
  },

  async pullRemote(version) {
    const boardId = get().boardId
    if (boardId == null || !engine || version <= engine.currentVersion) return
    if (pointerDown) {
      deferredPull = Math.max(deferredPull ?? 0, version)
      return
    }
    const fresh = await getScene(boardId).catch(() => null)
    if (!fresh || !engine || get().boardId !== boardId || fresh.version <= engine.currentVersion) {
      return
    }
    const local = useSceneStore.getState().document
    const merged = mergeScenes(syncedDocument ?? fresh.document, local, fresh.document)
    syncedDocument = fresh.document
    engine.setVersion(fresh.version)
    set({ version: fresh.version })
    lastDocument = merged
    if (merged !== local) useSceneStore.getState().applyRemoteDocument(merged)
    // Lokalne zmiany, których serwer jeszcze nie ma, idą w zapisie z nową wersją;
    // bez nich zaplanowany zapis jest zbędny (zawierałby starą scenę).
    if (!get().readOnly && hasLocalChanges(fresh.document, merged)) {
      engine.schedule(merged, null)
    } else {
      engine.cancelPending()
    }
  },

  dispose() {
    initSeq++
    syncedDocument = null
    deferredPull = null
    unsubscribeScene?.()
    unsubscribeScene = null
    engine?.dispose()
    engine = null
    lastDocument = null
    lastCamera = DEFAULT_CAMERA
  },

  async refreshAssets() {
    const boardId = get().boardId
    if (boardId == null) return
    set({ assetsLoading: true })
    try {
      const assets = await listAssets(boardId)
      set({ assets })
    } catch {
      // Chwilowy błąd sieci nie czyści listy (DAT-5) — zostaje poprzedni stan.
      toast.error(translate('session.assetsRefreshFailed'))
    } finally {
      set({ assetsLoading: false })
    }
  },

  async saveNow(opts) {
    const boardId = get().boardId
    if (boardId == null || get().readOnly) return
    // Bez niezapisanych zmian nie ma czego wysyłać (nie podbijamy wersji).
    const status = get().saveStatus
    if (status !== 'dirty' && status !== 'error' && !engine?.hasPending) return
    const { document } = useSceneStore.getState()
    const version = engine?.currentVersion ?? get().version
    try {
      const next = await putScene(
        boardId,
        { version, document, appState: null },
        { keepalive: opts?.keepalive ?? false }
      )
      engine?.cancelPending()
      engine?.setVersion(next)
      set({ version: next, saveStatus: 'saved' })
    } catch (error) {
      if (!(error instanceof AutosaveConflictError)) {
        set({ saveStatus: 'error' })
      }
    }
  },

  async uploadFiles(files, source, point) {
    const boardId = get().boardId
    if (boardId == null) return

    // Walidacja po stronie klienta — czytelny komunikat, bez cichej porażki.
    const valid: File[] = []
    for (const file of files) {
      const verdict = validateClientFile(file)
      if (verdict.ok) valid.push(file)
      else toast.error(fileRejectMessage(file.name, verdict.reason))
    }
    if (valid.length === 0) return

    // Optymistyczne placeholdery — od razu po wklejeniu/upuszczeniu.
    const placeholders = valid.map((file, i) =>
      createPendingUpload({
        id: createElementId(),
        source,
        filename: file.name,
        x: point.x + i * 24,
        y: point.y + i * 24,
      })
    )
    set({ pendingUploads: [...get().pendingUploads, ...placeholders] })

    try {
      const assets = await uploadFiles(boardId, valid, source, (fileIndex, e) => {
        const progress = e.total > 0 ? e.loaded / e.total : 0
        set((state) => ({
          pendingUploads: state.pendingUploads.map((u) =>
            u.id === placeholders[fileIndex].id ? { ...u, progress } : u
          ),
        }))
      })

      // Podmiana placeholderów na właściwe elementy sceny (w kolejności plików).
      // Kolejne obrazy układamy w rzędzie (bez nakładania), duże skalujemy do
      // MAX_IMAGE_EDGE — plik się nie zmienia, tylko jego rozmiar na płótnie.
      let cursorX = point.x
      for (const [i, asset] of assets.entries()) {
        const resolution = resolveUploadResult(get().pendingUploads, placeholders[i].id, {
          ok: true,
          asset: { id: String(asset.id), width: asset.width, height: asset.height },
          elementId: createElementId(),
        })
        set({ pendingUploads: resolution.pendingUploads })
        if (resolution.addedElement) {
          const el = resolution.addedElement
          const fit = Math.min(1, MAX_IMAGE_EDGE / Math.max(el.width, el.height, 1))
          const placed = {
            ...el,
            x: cursorX,
            y: point.y,
            width: Math.round(el.width * fit),
            height: Math.round(el.height * fit),
          }
          cursorX += placed.width + IMAGE_GAP
          useSceneStore.getState().addElement(placed)
        }
      }
      await get().refreshAssets()
    } catch (error) {
      // Rollback: usuń wszystkie placeholdery tej partii (brak sierot).
      const ids = new Set(placeholders.map((p) => p.id))
      set({ pendingUploads: get().pendingUploads.filter((u) => !ids.has(u.id)) })
      toast.error(error instanceof Error ? error.message : translate('session.uploadFailed'))
    }
  },

  async addLink(url, point) {
    const boardId = get().boardId
    if (boardId == null) return
    try {
      const asset = await createLinkAsset(boardId, url)
      const title = asset.linkMeta?.title?.trim()
      const label = title ? `${title}\n${url}` : url
      const el = createLinkSticky(label, point, String(asset.id))
      useSceneStore.getState().addElement(el)
      await get().refreshAssets()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translate('session.linkFailed'))
    }
  },

  addTextNote(text, point) {
    useSceneStore.getState().addElement(createTextSticky(text, point))
  },

  async updateUsage(assetId, usage) {
    const before = get().assets
    set({
      assets: before.map((a) => (String(a.id) === String(assetId) ? { ...a, usage } : a)),
    })
    try {
      const updated = await apiUpdateUsage(assetId, usage)
      set({ assets: get().assets.map((a) => (String(a.id) === String(assetId) ? updated : a)) })
    } catch {
      set({ assets: before })
      toast.error(translate('session.noteFailed'))
    }
  },

  async updateNote(assetId, note) {
    try {
      const updated = await apiUpdateNote(assetId, note)
      set({ assets: get().assets.map((a) => (String(a.id) === String(assetId) ? updated : a)) })
    } catch {
      toast.error(translate('session.noteFailed'))
    }
  },

  async deleteAsset(assetId) {
    try {
      await apiDeleteAsset(assetId)
      set({ assets: get().assets.filter((a) => String(a.id) !== String(assetId)) })

      // Usuń też elementy płótna wskazujące ten asset (bez sierot).
      const store = useSceneStore.getState()
      const ids = store.document.elements
        .filter((el) => elementAssetId(el) === String(assetId))
        .map((el) => el.id)
      if (ids.length > 0) store.deleteElements(ids)
    } catch {
      toast.error(translate('session.deleteFailed'))
    }
  },

  addBrandKitNote(text) {
    const store = useSceneStore.getState()
    const bounds = store.document.elements.map(getElementBounds)
    const x = bounds.length ? Math.max(...bounds.map((b) => b.x + b.width)) + 160 : 0
    const y = bounds.length ? Math.min(...bounds.map((b) => b.y)) : 0
    const lines = text
      .split('\n')
      .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 52)), 0)
    const el: SceneStickyElement = {
      ...createTextSticky(text, { x, y }),
      width: 440,
      height: Math.min(900, 40 + lines * 20),
    }
    store.addElement(el)
    store.selectOnly([el.id])
    const root = document.querySelector('[data-testid="canvas-root"]')?.getBoundingClientRect()
    const vw = Math.max(1, root?.width ?? window.innerWidth - PANEL_WIDTH)
    const vh = Math.max(1, root?.height ?? window.innerHeight - CHROME_HEIGHT)
    store.setCamera({ x: vw / 2 - (x + el.width / 2), y: vh / 2 - (y + el.height / 2), scale: 1 })
  },

  async importSite(url) {
    const boardId = get().boardId
    if (boardId == null) return false
    try {
      const result = await apiImportSite(boardId, url)
      await get().refreshAssets()
      const ids = result.assets.map((a) => String(a.id))
      await get().placeInboxAssets(ids)
      get().addBrandKitNote(result.note)
      toast.success(
        translate('siteImport.done', {
          host: result.summary.host,
          colors: result.summary.colors,
          fonts: result.summary.fonts.join(', ') || '—',
        })
      )
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translate('siteImport.failedShort'))
      return false
    }
  },

  async importFigma(input) {
    const boardId = get().boardId
    if (boardId == null) throw new Error('no board')
    const result = await apiImportFigma(boardId, input)
    await get().refreshAssets()
    await get().placeInboxAssets(result.assets.map((a) => String(a.id)))
    get().addBrandKitNote(result.note)
    toast.success(
      translate('figma.done', {
        file: result.summary.file,
        frames: result.summary.frames,
        fonts: result.summary.fonts.join(', ') || '—',
      })
    )
    return result
  },

  async placeInboxAssets(assetIds) {
    const store = useSceneStore.getState()
    const assets = get().assets.filter((a) => assetIds.includes(String(a.id)))
    if (!assets.length) return

    // Na prawo od istniejącej zawartości, w jednym rzędzie.
    const bounds = store.document.elements.map(getElementBounds)
    const right = bounds.length ? Math.max(...bounds.map((b) => b.x + b.width)) : 0
    const top = bounds.length ? Math.min(...bounds.map((b) => b.y)) : 0
    let cursorX = bounds.length ? right + 160 : 0
    for (const asset of assets) {
      if (asset.kind === 'link') {
        const title = asset.linkMeta?.title?.trim()
        const el = createLinkSticky(
          title ? `${title}\n${asset.filename}` : asset.filename,
          { x: cursorX, y: top },
          String(asset.id)
        )
        store.addElement(el)
        cursorX += el.width + IMAGE_GAP
        continue
      }
      const w = asset.width ?? 480
      const h = asset.height ?? 320
      const fit = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h, 1))
      const el: SceneElement = {
        id: createElementId(),
        type: 'image',
        assetId: String(asset.id),
        x: cursorX,
        y: top,
        rotation: 0,
        opacity: 1,
        width: Math.round(w * fit),
        height: Math.round(h * fit),
      }
      store.addElement(el)
      cursorX += (el as { width: number }).width + IMAGE_GAP
    }
    await Promise.all(assets.map((a) => acceptInboxAsset(String(a.id)).catch(() => {})))
    set({
      assets: get().assets.map((a) =>
        assetIds.includes(String(a.id)) ? { ...a, inbox: false } : a
      ),
    })
    get().centerOnAsset(String(assets[0].id))
  },

  centerOnAsset(assetId) {
    const store = useSceneStore.getState()
    const el = store.document.elements.find((e) => elementAssetId(e) === String(assetId))
    if (!el) {
      toast.error(translate('session.notOnCanvas'))
      return
    }
    store.selectOnly([el.id])
    const bounds = getElementBounds(el)
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    // Rzeczywisty rozmiar płótna (panel boczny ma różną szerokość wg zakładki).
    const root = document.querySelector('[data-testid="canvas-root"]')?.getBoundingClientRect()
    const vw = Math.max(1, root?.width ?? window.innerWidth - PANEL_WIDTH)
    const vh = Math.max(1, root?.height ?? window.innerHeight - CHROME_HEIGHT)
    store.setCamera({ x: vw / 2 - cx, y: vh / 2 - cy, scale: 1 })
  },
}))

/** Zwraca `assetId` elementu (dla image wymagane, dla sticky opcjonalne). */
function elementAssetId(el: SceneElement): string | null {
  // API zwraca id assetu jako liczbę, scena trzyma je jako tekst — porównujemy tekstowo.
  if (el.type === 'image') return String(el.assetId)
  if (el.type === 'sticky' && el.assetId) return String(el.assetId)
  return null
}

function cameraFromAppState(appState: Record<string, unknown> | null | undefined): Camera {
  const cam = (appState ?? {}).camera as { x?: unknown; y?: unknown; scale?: unknown } | undefined
  if (
    cam &&
    typeof cam.x === 'number' &&
    typeof cam.y === 'number' &&
    typeof cam.scale === 'number'
  ) {
    return { x: cam.x, y: cam.y, scale: cam.scale }
  }
  return DEFAULT_CAMERA
}

function createLinkSticky(
  text: string,
  point: { x: number; y: number },
  assetId: string
): SceneStickyElement {
  return {
    id: createElementId(),
    type: 'sticky',
    x: point.x,
    y: point.y,
    rotation: 0,
    opacity: 1,
    width: 280,
    height: 110,
    text,
    fill: DEFAULTS.linkCard,
    fontSize: 13,
    assetId,
  }
}

function createTextSticky(text: string, point: { x: number; y: number }): SceneStickyElement {
  return {
    id: createElementId(),
    type: 'sticky',
    x: point.x,
    y: point.y,
    rotation: 0,
    opacity: 1,
    width: 220,
    height: 120,
    text,
    fill: DEFAULTS.sticky,
    fontSize: 14,
  }
}

function fileRejectMessage(name: string, reason: ClientFileRejectReason): string {
  switch (reason) {
    case 'too_large':
      return translate('file.tooLarge', { name })
    case 'dangerous':
      return translate('file.dangerous', { name })
    case 'unsupported':
      return translate('file.unsupported', { name })
  }
}

/**
 * Materiały widoczne w panelu: tylko te, które są na płótnie. Element usunięty
 * z płótna znika z listy od razu, a Ctrl+Z przywraca go razem z elementem.
 */
export function useCanvasAssets(): AssetDto[] {
  const assets = useBoardStore((s) => s.assets)
  const elements = useSceneStore((s) => s.document.elements)
  return useMemo(() => {
    const onCanvas = new Set(elements.map(elementAssetId).filter((id): id is string => id !== null))
    return assets.filter((a) => onCanvas.has(String(a.id)))
  }, [assets, elements])
}

// Zdalne zmiany nie wchodzą w trakcie gestu (przeciąganie, rysowanie, zaznaczanie) —
// dociągamy je zaraz po puszczeniu przycisku.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => {
    pointerDown = true
  })
  window.addEventListener('pointerup', () => {
    pointerDown = false
    if (deferredPull != null) {
      const version = deferredPull
      deferredPull = null
      void useBoardStore.getState().pullRemote(version)
    }
  })
}

// Kamera per użytkownik i tablica, w przeglądarce (DAT-4).
const CAMERA_KEY = (boardId: number) => `canvai.camera.${boardId}`
let cameraTimer: ReturnType<typeof setTimeout> | null = null

function loadCamera(boardId: number): Camera | null {
  try {
    const raw = localStorage.getItem(CAMERA_KEY(boardId))
    if (!raw) return null
    const cam = JSON.parse(raw) as Camera
    return Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.scale)
      ? cam
      : null
  } catch {
    return null
  }
}

function saveCamera(boardId: number, camera: Camera) {
  if (cameraTimer) clearTimeout(cameraTimer)
  cameraTimer = setTimeout(() => {
    try {
      localStorage.setItem(CAMERA_KEY(boardId), JSON.stringify(camera))
    } catch {
      // Brak dostępu do localStorage (tryb prywatny) — widok po prostu się nie zapamięta.
    }
  }, 400)
}

// Po powrocie sieci nieudany zapis idzie od razu (DAT-5).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (engine?.failing) void engine.retryNow()
  })
}

/** Czy są zmiany, których serwer jeszcze nie ma (ostrzeżenie przy zamykaniu karty). */
export function hasUnsavedChanges(): boolean {
  const status = useBoardStore.getState().saveStatus
  return (
    status === 'dirty' || status === 'saving' || status === 'error' || Boolean(engine?.hasPending)
  )
}
