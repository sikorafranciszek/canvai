/**
 * Zgoda na analitykę Microsoft Clarity w aplikacji — ta sama decyzja co na
 * canvai.dev (cookie `canvai_consent` na domenie `.canvai.dev`). Clarity ładuje
 * się wyłącznie po zgodzie; wycofanie zgody kasuje jej cookies.
 */
import { create } from 'zustand'
import { useLocaleStore } from '~/i18n'

const COOKIE = 'canvai_consent'
const MAX_AGE = 180 * 24 * 3600

export type ConsentChoice = 'granted' | 'denied'

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] }
  }
}

export function readConsent(): ConsentChoice | null {
  if (typeof document === 'undefined') return null
  const value = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(granted|denied)`))?.[1]
  return (value as ConsentChoice | undefined) ?? null
}

function writeConsent(choice: ConsentChoice) {
  const shared = location.hostname === 'canvai.dev' || location.hostname.endsWith('.canvai.dev')
  document.cookie = [
    `${COOKIE}=${choice}`,
    'path=/',
    `max-age=${MAX_AGE}`,
    'samesite=lax',
    ...(shared ? ['domain=.canvai.dev', 'secure'] : []),
  ].join('; ')
}

let loaded = false
export function loadClarity(projectId: string) {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  // Oficjalny snippet Clarity.
  const w = window as any
  w.clarity =
    w.clarity ||
    function (...args: unknown[]) {
      ;(w.clarity.q = w.clarity.q || []).push(args)
    }
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.clarity.ms/tag/${projectId}`
  const first = document.getElementsByTagName('script')[0]
  first.parentNode!.insertBefore(script, first)
  window.clarity!('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' })
}

interface ConsentState {
  open: boolean
  show: () => void
  decide: (choice: ConsentChoice, projectId: string | null) => void
}

export const useConsentStore = create<ConsentState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  decide(choice, projectId) {
    writeConsent(choice)
    if (choice === 'granted' && projectId) loadClarity(projectId)
    else if (choice === 'denied' && loaded) window.clarity?.('consent', false)
    set({ open: false })
  },
}))

/** Polityka prywatności na canvai.dev w języku interfejsu. */
export function privacyUrl(): string {
  return useLocaleStore.getState().locale === 'pl'
    ? 'https://canvai.dev/pl/prywatnosc/'
    : 'https://canvai.dev/privacy/'
}
