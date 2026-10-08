/**
 * Współpraca na żywo po stronie przeglądarki: strumień zdarzeń tablicy (SSE),
 * obecność uczestników i ich kursory. Zdarzenia uruchamiają dociągnięcie
 * sceny (scalanie w `session.pullRemote`), materiałów, DESIGN.md i komentarzy.
 */
import { create } from 'zustand'
import { CLIENT_ID, csrfHeaders } from '~/lib/board/api'
import { useBoardStore } from '~/lib/board/session'
import { useDesignStore, type DocEvent } from '~/lib/board/design'
import { useCommentsStore } from '~/lib/board/comments'

export interface LiveParticipant {
  clientId: string
  userId: number
  name: string
  initials: string
  color: string
  role: string
}

export interface LiveCursor {
  clientId: string
  userId: number
  name: string
  color: string
  x: number
  y: number
  at: number
}

interface LiveState {
  boardId: number | null
  connected: boolean
  participants: LiveParticipant[]
  cursors: Record<string, LiveCursor>
  connect: (boardId: number) => void
  disconnect: () => void
}

let source: EventSource | null = null
let lastCursorSent = 0
let pendingCursor: { x: number; y: number } | null = null
let cursorTimer: ReturnType<typeof setTimeout> | null = null
let membersListener: (() => void) | null = null

/** Komponent listy członków nasłuchuje zmian (zaproszenia, role). */
export function onMembersChanged(listener: (() => void) | null) {
  membersListener = listener
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  boardId: null,
  connected: false,
  participants: [],
  cursors: {},

  connect(boardId) {
    if (get().boardId === boardId && source) return
    get().disconnect()
    if (typeof EventSource === 'undefined') return
    set({ boardId, participants: [], cursors: {} })
    const es = new EventSource(`/api/boards/${boardId}/events?clientId=${CLIENT_ID}`)
    source = es
    const json = (e: MessageEvent) => {
      try {
        return JSON.parse(e.data)
      } catch {
        return {}
      }
    }
    es.addEventListener('open', () => {
      set({ connected: true })
      useDesignStore.setState({ liveConnected: true })
    })
    es.addEventListener('error', () => {
      set({ connected: false })
      useDesignStore.setState({ liveConnected: false })
    })
    es.addEventListener('hello', (e) => {
      set({ connected: true, participants: json(e as MessageEvent).participants ?? [] })
      // Po (ponownym) połączeniu mogliśmy przegapić zmiany — dociągamy stan.
      void useBoardStore.getState().pullRemote(Number.MAX_SAFE_INTEGER)
    })
    es.addEventListener('presence', (e) => {
      const participants = (json(e as MessageEvent).participants ?? []) as LiveParticipant[]
      const alive = new Set(participants.map((p) => p.userId))
      const cursors = Object.fromEntries(
        Object.entries(get().cursors).filter(([, c]) => alive.has(c.userId))
      )
      set({ participants, cursors })
    })
    es.addEventListener('cursor', (e) => {
      const c = json(e as MessageEvent) as LiveCursor
      if (!c.clientId || c.clientId === CLIENT_ID) return
      set({ cursors: { ...get().cursors, [c.clientId]: { ...c, at: Date.now() } } })
    })
    es.addEventListener('scene', (e) => {
      const { version } = json(e as MessageEvent)
      void useBoardStore.getState().pullRemote(Number(version) || 0)
    })
    es.addEventListener('assets', () => void useBoardStore.getState().refreshAssets())
    es.addEventListener('comments', () => void useCommentsStore.getState().load(boardId))
    es.addEventListener('members', () => membersListener?.())
    es.addEventListener('doc', (e) => {
      useDesignStore.getState().onDocEvent(json(e as MessageEvent) as DocEvent)
    })
  },

  disconnect() {
    source?.close()
    source = null
    if (cursorTimer) clearTimeout(cursorTimer)
    cursorTimer = null
    set({ boardId: null, connected: false, participants: [], cursors: {} })
  },
}))

function sendCursor() {
  cursorTimer = null
  const { boardId } = useLiveStore.getState()
  if (boardId == null || !pendingCursor) return
  const { x, y } = pendingCursor
  pendingCursor = null
  lastCursorSent = Date.now()
  void fetch(`/api/boards/${boardId}/cursor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
    body: JSON.stringify({ clientId: CLIENT_ID, x, y }),
  }).catch(() => {})
}

/** Pozycja kursora w układzie sceny (wysyłana najwyżej co ~80 ms i tylko, gdy ktoś patrzy). */
export function reportCursor(x: number, y: number) {
  const { participants } = useLiveStore.getState()
  if (participants.length < 2) return
  pendingCursor = { x, y }
  if (cursorTimer) return
  const wait = Math.max(0, 80 - (Date.now() - lastCursorSent))
  cursorTimer = setTimeout(sendCursor, wait)
}
