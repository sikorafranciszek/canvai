/**
 * Ruch strony: odsłanianie sekcji, pochylenie okna w hero zależne od
 * przewijania, cień nagłówka i pasek postępu. Bez bibliotek — jeden
 * IntersectionObserver i jeden handler scrolla w requestAnimationFrame.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const root = document.documentElement

// Odsłanianie: element dostaje `.is-in` raz, przy wejściu w viewport.
const revealables = document.querySelectorAll<HTMLElement>('[data-reveal]')
if (reduced || !('IntersectionObserver' in window)) {
  revealables.forEach((el) => el.classList.add('is-in'))
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        io.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  )
  revealables.forEach((el) => io.observe(el))

  // Po odsłonięciu zdejmujemy opóźnienie kaskady — hover ma reagować od razu.
  document.addEventListener('transitionend', (event) => {
    const el = event.target as HTMLElement
    if (event.propertyName === 'opacity' && el.matches?.('[data-reveal].is-in')) {
      el.classList.add('is-done')
    }
  })
}

const header = document.querySelector<HTMLElement>('.header')
const stage = document.querySelector<HTMLElement>('[data-tilt]')
const progress = document.querySelector<HTMLElement>('.progress')

let ticking = false
function onScroll() {
  ticking = false
  const y = window.scrollY
  header?.classList.toggle('is-scrolled', y > 8)

  const max = root.scrollHeight - window.innerHeight
  progress?.style.setProperty('--progress', String(max > 0 ? Math.min(1, y / max) : 0))

  if (stage && !reduced) {
    // 1 = w pełni pochylone (strona na górze), 0 = płasko (okno w połowie ekranu).
    const rect = stage.getBoundingClientRect()
    const start = window.innerHeight
    const end = window.innerHeight * 0.35
    const t = Math.min(1, Math.max(0, (rect.top - end) / (start - end)))
    stage.style.setProperty('--tilt', t.toFixed(3))
  }
}

window.addEventListener(
  'scroll',
  () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(onScroll)
  },
  { passive: true }
)
window.addEventListener('resize', onScroll, { passive: true })
onScroll()
