/**
 * Podgląd UI (przykładowa strona HTML z wersji DESIGN.md): stan okna, zlecanie
 * generacji i polling statusu.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { router } from '@inertiajs/react'
import { csrfHeaders } from '~/lib/board/api'
import { useBillingStore } from '~/lib/billing'
import { translate } from '~/i18n'

export interface PreviewDto {
  id: number
  version: number
  status: 'queued' | 'running' | 'ready' | 'failed'
  error: string | null
  model: string | null
  creditsCharged: number | null
  createdAt: string | null
  generatedAt: string | null
  url: string | null
}

interface PreviewState {
  open: boolean
  boardId: number | null
  version: number | null
  preview: PreviewDto | null
  cost: number
  hasSpec: boolean
  loading: boolean
  starting: boolean
  show: (boardId: number, version: number) => Promise<void>
  close: () => void
  generate: (force?: boolean) => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null
const pending = (p: PreviewDto | null) => p?.status === 'queued' || p?.status === 'running'

async function fetchPreview(boardId: number, version: number) {
  const res = await fetch(`/api/boards/${boardId}/design-doc/preview?version=${version}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(translate('preview.loadFailed'))
  return (await res.json()) as { data: PreviewDto | null; meta: { cost: number; hasSpec: boolean } }
}

export const usePreviewStore = create<PreviewState>()((set, get) => {
  function poll() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      const { boardId, version, open } = get()
      if (!open || boardId == null || version == null) return
      try {
        const { data } = await fetchPreview(boardId, version)
        set({ preview: data })
        if (pending(data)) return poll()
        void useBillingStore.getState().load()
        if (data?.status === 'failed') toast.error(data.error ?? translate('preview.failed'))
      } catch {
        poll()
      }
    }, 1500)
  }

  return {
    open: false,
    boardId: null,
    version: null,
    preview: null,
    cost: 0,
    hasSpec: true,
    loading: false,
    starting: false,

    async show(boardId, version) {
      set({ open: true, boardId, version, preview: null, loading: true })
      try {
        const { data, meta } = await fetchPreview(boardId, version)
        set({ preview: data, cost: meta.cost, hasSpec: meta.hasSpec })
        if (pending(data)) poll()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : translate('preview.loadFailed'))
      } finally {
        set({ loading: false })
      }
    },

    close() {
      if (timer) clearTimeout(timer)
      set({ open: false })
    },

    async generate(force = false) {
      const { boardId, version } = get()
      if (boardId == null || version == null || get().starting) return
      set({ starting: true })
      try {
        const res = await fetch(`/api/boards/${boardId}/design-doc/preview`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...csrfHeaders(),
          },
          body: JSON.stringify({ version, force }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          data?: PreviewDto
          message?: string
        }
        if (res.ok || res.status === 409) {
          if (body.data) set({ preview: body.data })
          if (pending(body.data ?? null)) poll()
          void useBillingStore.getState().load()
          return
        }
        toast.error(body.message ?? translate('preview.failed'), {
          duration: 8000,
          ...(res.status === 402
            ? {
                action: {
                  label: translate('billing.topUp'),
                  onClick: () => router.visit('/billing'),
                },
              }
            : {}),
        })
      } catch {
        toast.error(translate('preview.failed'))
      } finally {
        set({ starting: false })
      }
    },
  }
})
