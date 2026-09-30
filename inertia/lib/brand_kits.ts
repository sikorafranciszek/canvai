/**
 * Brand kity: lista, zapis z DESIGN.md, zmiana nazwy, usuwanie i treść
 * notatki wstawianej na płótno (czyta ją AI przy generacji).
 */
import { create } from 'zustand'
import { csrfHeaders } from '~/lib/board/api'
import { translate } from '~/i18n'

export interface BrandKitDto {
  id: number
  name: string
  colors: { name: string; hex: string; role: string }[]
  fonts: { name: string; role: string }[]
  rules: string[]
  sourceBoardId: number | null
  sourceVersion: number | null
  createdAt: string | null
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...csrfHeaders(),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => ({}))) as {
    data?: T
    message?: string
    meta?: unknown
  }
  if (!res.ok)
    throw Object.assign(new Error(body.message ?? translate('brandKits.failed')), {
      status: res.status,
    })
  return body as T
}

export async function listBrandKits() {
  return call<{ data: BrandKitDto[]; meta: { allowed: boolean } }>('/api/brand-kits')
}

export async function createBrandKit(boardId: number, version?: number) {
  return (
    await call<{ data: BrandKitDto }>('/api/brand-kits', {
      method: 'POST',
      body: JSON.stringify({ boardId, version }),
    })
  ).data
}

export async function renameBrandKit(id: number, name: string) {
  return (
    await call<{ data: BrandKitDto }>(`/api/brand-kits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  ).data
}

export async function deleteBrandKit(id: number) {
  await call(`/api/brand-kits/${id}`, { method: 'DELETE' })
}

/** Krótka rola (do pierwszego separatora, cięta na granicy słowa). */
function short(role: string): string {
  const head = role.split(/\s[—–-]\s|[,.;(]/)[0].trim()
  if (head.length <= 36) return head
  return head.slice(0, 36).replace(/\s+\S*$/, '') + '…'
}

/** Notatka na płótno — po angielsku, bo czyta ją model generujący DESIGN.md. */
export function brandKitNote(kit: BrandKitDto): string {
  const lines = [`BRAND KIT — ${kit.name} (use these exact values)`]
  if (kit.colors.length) {
    lines.push(
      `Colors: ${kit.colors.map((c) => `${c.name} ${c.hex}${c.role ? ` (${short(c.role)})` : ''}`).join('; ')}`
    )
  }
  if (kit.fonts.length) {
    lines.push(
      `Fonts: ${kit.fonts.map((f) => `${f.name}${f.role ? ` (${short(f.role)})` : ''}`).join('; ')}`
    )
  }
  if (kit.rules.length) lines.push(`Rules: ${kit.rules.join(' · ')}`)
  return lines.join('\n')
}

interface BrandKitState {
  kits: BrandKitDto[]
  allowed: boolean
  loaded: boolean
  load: () => Promise<void>
}

export const useBrandKitStore = create<BrandKitState>()((set) => ({
  kits: [],
  allowed: false,
  loaded: false,
  async load() {
    try {
      const { data, meta } = await listBrandKits()
      set({ kits: data, allowed: meta.allowed, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))
