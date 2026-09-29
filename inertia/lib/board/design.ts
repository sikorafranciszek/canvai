/**
 * Store generacji DESIGN.md: aktywna zakładka panelu, historia wersji,
 * wybrana wersja z treścią, stan generacji i polling statusu (co 1,5 s).
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import {
  DesignDocRequestError,
  generateDesignDoc,
  getDesignDoc,
  listDesignDocs,
  type DesignDocDto,
} from '~/lib/board/api'
import { useBoardStore } from '~/lib/board/session'
import { translate } from '~/i18n'

export type SidePanelTab = 'assets' | 'design'

const POLL_MS = 1500

interface DesignState {
  boardId: number | null
  tab: SidePanelTab
  versions: DesignDocDto[]
  /** Wybrana wersja (z treścią). */
  current: DesignDocDto | null
  /** Treść poprzedniej gotowej wersji — do diffu. */
  previous: DesignDocDto | null
  /** Generacja w toku (queued/running), śledzona pollingiem. */
  active: DesignDocDto | null
  loading: boolean
  starting: boolean
  /** Ostatnie „bez zmian” — panel proponuje wymuszenie. */
  reusedNotice: boolean

  init: (boardId: number) => Promise<void>
  dispose: () => void
  setTab: (tab: SidePanelTab) => void
  selectVersion: (version: number) => Promise<void>
  generate: (opts?: { force?: boolean }) => Promise<void>
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function isPending(doc: DesignDocDto | null | undefined): boolean {
  return doc?.status === 'queued' || doc?.status === 'running'
}

export const useDesignStore = create<DesignState>()((set, get) => {
  async function refreshVersions(boardId: number) {
    const versions = await listDesignDocs(boardId)
    if (get().boardId === boardId) set({ versions })
    return versions
  }

  async function loadPrevious(boardId: number, current: DesignDocDto | null) {
    const prev = get().versions.find(
      (v) => current && v.version < current.version && v.status === 'ready'
    )
    const previous = prev ? await getDesignDoc(boardId, prev.version) : null
    if (get().boardId === boardId) set({ previous })
  }

  function schedulePoll(boardId: number, version: number, mySeq: number) {
    stopPolling()
    pollTimer = setTimeout(async () => {
      if (mySeq !== seq) return
      try {
        const doc = await getDesignDoc(boardId, version)
        if (mySeq !== seq || !doc) return
        if (isPending(doc)) {
          set({ active: doc })
          schedulePoll(boardId, version, mySeq)
          return
        }

        set({ active: null, current: doc })
        await refreshVersions(boardId)
        await loadPrevious(boardId, doc)
        if (doc.status === 'ready') toast.success(translate('doc.ready', { version: doc.version }))
        else toast.error(doc.error ?? translate('doc.failedToast'))
      } catch {
        // Chwilowy błąd sieci — próbujemy dalej.
        if (mySeq === seq) schedulePoll(boardId, version, mySeq)
      }
    }, POLL_MS)
  }

  return {
    boardId: null,
    tab: 'assets',
    versions: [],
    current: null,
    previous: null,
    active: null,
    loading: false,
    starting: false,
    reusedNotice: false,

    async init(boardId) {
      stopPolling()
      const mySeq = ++seq
      set({
        boardId,
        versions: [],
        current: null,
        previous: null,
        active: null,
        loading: true,
        reusedNotice: false,
      })
      try {
        const versions = await refreshVersions(boardId)
        if (mySeq !== seq) return
        const pending = versions.find(isPending) ?? null
        const latestReady = versions.find((v) => v.status === 'ready') ?? versions[0] ?? null
        const current = latestReady ? await getDesignDoc(boardId, latestReady.version) : null
        if (mySeq !== seq) return
        set({ current, active: pending })
        await loadPrevious(boardId, current)
        if (pending) schedulePoll(boardId, pending.version, mySeq)
      } catch {
        // Brak dokumentów to nie błąd — panel pokaże stan pusty.
      } finally {
        if (mySeq === seq) set({ loading: false })
      }
    },

    dispose() {
      stopPolling()
      seq++
      set({ boardId: null, versions: [], current: null, previous: null, active: null })
    },

    setTab(tab) {
      set({ tab })
    },

    async selectVersion(version) {
      const boardId = get().boardId
      if (boardId == null) return
      set({ loading: true, reusedNotice: false })
      try {
        const doc = await getDesignDoc(boardId, version)
        set({ current: doc })
        await loadPrevious(boardId, doc)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : translate('doc.loadVersionFailed'))
      } finally {
        set({ loading: false })
      }
    },

    async generate(opts) {
      const boardId = get().boardId
      if (boardId == null || get().starting || isPending(get().active)) return
      set({ starting: true, tab: 'design', reusedNotice: false })

      try {
        // AI ma widzieć aktualną scenę — zapisujemy przed zleceniem generacji.
        const board = useBoardStore.getState()
        if (board.saveStatus === 'dirty' || board.saveStatus === 'error') await board.saveNow()

        const result = await generateDesignDoc(boardId, opts)
        if (result.kind === 'reused') {
          set({ current: result.doc, reusedNotice: true })
          await loadPrevious(boardId, result.doc)
          toast.info(translate('doc.unchangedToast', { version: result.doc.version }))
          return
        }
        set({ active: result.doc })
        await refreshVersions(boardId)
        schedulePoll(boardId, result.doc.version, seq)
      } catch (error) {
        if (error instanceof DesignDocRequestError && error.status === 409 && error.doc) {
          set({ active: error.doc })
          schedulePoll(boardId, error.doc.version, seq)
          return
        }
        toast.error(error instanceof Error ? error.message : translate('doc.startFailed'))
      } finally {
        set({ starting: false })
      }
    },
  }
})

export function progressLabel(doc: DesignDocDto | null): string {
  if (!doc) return ''
  if (doc.status === 'queued') return doc.error ?? translate('doc.progress.queued')
  const p = doc.progress
  if (!p) return translate('doc.progress.preparing')
  if (p.stage === 'analyze') return translate('doc.progress.analyze', { done: p.done, total: p.total })
  if (p.stage === 'compose') return translate('doc.progress.compose')
  return translate('doc.progress.render')
}

export function progressRatio(doc: DesignDocDto | null): number {
  const p = doc?.progress
  if (!p) return 0.05
  if (p.stage === 'analyze') return 0.05 + 0.7 * (p.total > 0 ? p.done / p.total : 1)
  if (p.stage === 'compose') return 0.8
  return 0.95
}
