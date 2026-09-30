/**
 * Zgoda na analitykę (Microsoft Clarity) — RODO / prawo telekomunikacyjne:
 * Clarity ładuje się WYŁĄCZNIE po zgodzie. Decyzja trafia do cookie
 * `canvai_consent` na domenie `.canvai.dev`, więc obowiązuje też w aplikacji
 * (app.canvai.dev) — użytkownik wybiera raz.
 */
const COOKIE = 'canvai_consent'
const CLARITY_ID = 'yqiijc59fv'
const MAX_AGE = 180 * 24 * 3600

type Choice = 'granted' | 'denied'

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] }
  }
}

function readChoice(): Choice | null {
  const value = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(granted|denied)`))?.[1]
  return (value as Choice | undefined) ?? null
}

function writeChoice(choice: Choice) {
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
function loadClarity() {
  if (loaded) return
  loaded = true
  // Oficjalny snippet Clarity (projekt canvai.dev).
  const c = window as any
  c.clarity =
    c.clarity ||
    function (...args: unknown[]) {
      ;(c.clarity.q = c.clarity.q || []).push(args)
    }
  const t = document.createElement('script')
  t.async = true
  t.src = `https://www.clarity.ms/tag/${CLARITY_ID}`
  const y = document.getElementsByTagName('script')[0]
  y.parentNode!.insertBefore(t, y)
  window.clarity!('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' })
}

const banner = document.querySelector<HTMLElement>('[data-consent]')

function hide() {
  banner?.setAttribute('hidden', '')
}

function show() {
  banner?.removeAttribute('hidden')
  banner?.querySelector<HTMLButtonElement>('[data-consent-accept]')?.focus({ preventScroll: true })
}

function decide(choice: Choice) {
  writeChoice(choice)
  if (choice === 'granted') loadClarity()
  // Wycofanie zgody: Clarity kasuje swoje cookies i przestaje zbierać dane.
  else if (loaded) window.clarity?.('consent', false)
  hide()
}

const current = readChoice()
if (current === 'granted') loadClarity()
if (!current) show()

banner?.querySelector('[data-consent-accept]')?.addEventListener('click', () => decide('granted'))
banner?.querySelector('[data-consent-reject]')?.addEventListener('click', () => decide('denied'))
document.querySelectorAll('[data-consent-open]').forEach((el) => el.addEventListener('click', show))
