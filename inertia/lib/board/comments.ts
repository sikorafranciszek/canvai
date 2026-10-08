/** Komentarze tablicy: wątki przypięte do płótna, odpowiedzi, rozwiązywanie. */
import { create } from 'zustand'
import { csrfHeaders } from '~/lib/board/api'
import { translate } from '~/i18n'
import { httpError, notifyError } from '~/lib/errors'

export interface BoardCommentDto {
  id: number
  parentId: number | null
  x: number | null
  y: number | null
  body: string
  resolved: boolean
  createdAt: string
  updatedAt: string | null
  author: { id: number; name: string; initials: string; color: string } | null
  canEdit: boolean
}

interface CommentsState {
  boardId: number | null
  comments: BoardCommentDto[]
  /** Tryb wstawiania: następne kliknięcie w płótno tworzy wątek. */
  placing: boolean
  /** Szkic nowego wątku (pozycja w układzie sceny). */
  draft: { x: number; y: number } | null
  openId: number | null
  showResolved: boolean
  load: (boardId: number) => Promise<void>
  setPlacing: (on: boolean) => void
  setDraft: (draft: { x: number; y: number } | null) => void
  open: (id: number | null) => void
  toggleResolved: () => void
  /** `true`, gdy zapisano — przy błędzie treść zostaje w polu (UX-3). */
  create: (body: string) => Promise<boolean>
  reply: (parentId: number, body: string) => Promise<boolean>
  resolve: (id: number, resolved: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('comments.failed'))
  return res.status === 204 ? (undefined as T) : ((await res.json()) as { data: T }).data
}

export const useCommentsStore = create<CommentsState>()((set, get) => ({
  boardId: null,
  comments: [],
  placing: false,
  draft: null,
  openId: null,
  showResolved: false,

  async load(boardId) {
    if (get().boardId !== boardId) set({ boardId, comments: [], openId: null, draft: null })
    try {
      const comments = await request<BoardCommentDto[]>(`/api/boards/${boardId}/comments`)
      if (get().boardId === boardId) set({ comments })
    } catch {
      // Komentarze są dodatkiem — brak listy nie blokuje tablicy.
    }
  },

  setPlacing: (placing) => set({ placing, draft: placing ? get().draft : null }),
  setDraft: (draft) => set({ draft, placing: false, openId: null }),
  open: (openId) => set({ openId, draft: null }),
  toggleResolved: () => set({ showResolved: !get().showResolved }),

  async create(body) {
    const { boardId, draft } = get()
    if (boardId == null || !draft) return false
    try {
      const c = await request<BoardCommentDto>(`/api/boards/${boardId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, x: draft.x, y: draft.y }),
      })
      set({ comments: [...get().comments, c], draft: null, openId: c.id })
      return true
    } catch (error) {
      notifyError(error, 'comments.failed')
      return false
    }
  },

  async reply(parentId, body) {
    const { boardId } = get()
    if (boardId == null) return false
    try {
      const c = await request<BoardCommentDto>(`/api/boards/${boardId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, parentId }),
      })
      set({ comments: [...get().comments, c] })
      return true
    } catch (error) {
      notifyError(error, 'comments.failed')
      return false
    }
  },

  async resolve(id, resolved) {
    try {
      const c = await request<BoardCommentDto>(`/api/comments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved }),
      })
      set({
        comments: get().comments.map((x) => (x.id === id ? c : x)),
        openId: resolved ? null : get().openId,
      })
    } catch (error) {
      notifyError(error, 'comments.failed')
    }
  },

  async remove(id) {
    try {
      await request(`/api/comments/${id}`, { method: 'DELETE' })
      set({
        comments: get().comments.filter((x) => x.id !== id && x.parentId !== id),
        openId: get().openId === id ? null : get().openId,
      })
    } catch (error) {
      notifyError(error, 'comments.failed')
    }
  },
}))
