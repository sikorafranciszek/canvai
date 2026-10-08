/**
 * Prawy panel tablicy z zakładkami „Materiały” i „DESIGN.md” + przycisk
 * generacji używany w górnym pasku edytora.
 */
import { useState } from 'react'
import { Coins, Sparkles } from 'lucide-react'
import { AssetPanel } from '~/components/canvas/AssetPanel'
import { DesignDocPanel } from '~/components/design/DesignDocPanel'
import { useDesignStore } from '~/lib/board/design'
import { useCanvasAssets } from '~/lib/board/session'
import { useSceneStore } from '~/lib/scene/store'
import { useT } from '~/i18n'

const ASSETS_WIDTH = 320
const DOC_MIN = 380
const DOC_MAX = 960
const DOC_KEY = 'canvai.docPanelWidth'

function storedDocWidth(): number {
  try {
    const n = Number(localStorage.getItem(DOC_KEY))
    return n >= DOC_MIN && n <= DOC_MAX ? n : 480
  } catch {
    return 480
  }
}

export function SidePanel({ open = true }: { open?: boolean }) {
  const { t } = useT()
  const tab = useDesignStore((s) => s.tab)
  const setTab = useDesignStore((s) => s.setTab)
  const pending = useDesignStore((s) => Boolean(s.active))
  const latest = useDesignStore((s) => s.versions.find((v) => v.status === 'ready'))
  const assetCount = useCanvasAssets().length
  const readMode = useDesignStore((s) => s.readMode)
  // Szerokość panelu DESIGN.md regulowana uchwytem (UX-6), pamiętana w przeglądarce;
  // tryb czytania rozszerza panel prawie na cały ekran.
  const [docWidth, setDocWidth] = useState(storedDocWidth)
  const [resizing, setResizing] = useState(false)
  const width =
    tab === 'assets'
      ? ASSETS_WIDTH
      : readMode
        ? Math.max(DOC_MIN, Math.min(1100, window.innerWidth - 96))
        : docWidth

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = docWidth
    setResizing(true)
    const move = (ev: PointerEvent) =>
      setDocWidth(Math.max(DOC_MIN, Math.min(DOC_MAX, start + (startX - ev.clientX))))
    const up = () => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDocWidth((w) => {
        try {
          localStorage.setItem(DOC_KEY, String(w))
        } catch {
          // brak localStorage — szerokość tylko do odświeżenia
        }
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    // Zewnętrzna „szuflada” animuje szerokość; treść ma stałą szerokość i jest
    // zakotwiczona do lewej krawędzi szuflady, więc wjeżdża z prawej krawędzi
    // ekranu. Po zamknięciu panel zostaje zamontowany (inert) — zachowuje stan.
    <div
      className="side-drawer"
      data-open={open}
      data-resizing={resizing}
      style={{ width: open ? width : 0 }}
      inert={!open}
      aria-hidden={!open}
    >
      <aside
        className="side-panel"
        data-testid="side-panel"
        aria-label={t('panel.label')}
        style={{ width, minWidth: width }}
      >
        {tab === 'design' && !readMode && open ? (
          <button
            type="button"
            className="side-panel__resize"
            aria-label={t('doc.resize')}
            data-testid="doc-panel-resize"
            onPointerDown={startResize}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0
              if (!step) return
              e.preventDefault()
              setDocWidth((w) => Math.max(DOC_MIN, Math.min(DOC_MAX, w + step)))
            }}
          />
        ) : null}
        <div className="side-panel__tabs" role="tablist" aria-label={t('panel.tabs')}>
          <button
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === 'assets'}
            data-testid="tab-assets"
            onClick={() => setTab('assets')}
          >
            {t('panel.materials')}
            <span style={{ opacity: 0.7 }}>{assetCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === 'design'}
            data-testid="tab-design"
            onClick={() => setTab('design')}
          >
            DESIGN.md
            {pending ? (
              <span
                className="spinner"
                style={{ width: 10, height: 10, borderWidth: 1.5 }}
                aria-label={t('panel.generating')}
              />
            ) : latest ? (
              <span style={{ opacity: 0.7 }}>v{latest.version}</span>
            ) : null}
          </button>
        </div>
        <div className="side-panel__body" role="tabpanel">
          {tab === 'assets' ? <AssetPanel /> : <DesignDocPanel />}
        </div>
      </aside>
    </div>
  )
}

export function GenerateDesignDocButton() {
  const { t } = useT()
  const generate = useDesignStore((s) => s.generate)
  const starting = useDesignStore((s) => s.starting)
  const pending = useDesignStore((s) => Boolean(s.active))
  const busy = starting || pending
  // Pusta tablica: przycisk nieaktywny od razu, z wyjaśnieniem (zamiast błędu serwera).
  const hasAssets = useCanvasAssets().length > 0
  const hasNotes = useSceneStore((s) =>
    s.document.elements.some(
      (el) =>
        (el.type === 'sticky' || el.type === 'text') &&
        Boolean((el as { text?: string }).text?.trim())
    )
  )
  const empty = !hasAssets && !hasNotes
  const estimate = useDesignStore((s) => s.estimate)
  const { tp } = useT()
  const showCost = estimate?.enforced && !busy

  return (
    <button
      type="button"
      className="btn btn--primary btn--sm"
      style={{ height: 32 }}
      data-testid="generate-design-doc"
      onClick={() => void generate()}
      disabled={busy || empty}
      aria-busy={busy}
      title={
        empty
          ? t('doc.needsContent')
          : showCost
            ? `${t('editor.generateHint')} — ${
                estimate.unchanged ? t('doc.costUnchanged') : tp('count.credits', estimate.credits)
              }`
            : t('editor.generateHint')
      }
    >
      {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Sparkles />}
      {busy ? t('editor.generating') : t('editor.generate')}
      {showCost && !estimate.unchanged ? (
        <span className="gen-cost" data-testid="generate-cost">
          <Coins />
          {estimate.credits}
        </span>
      ) : null}
    </button>
  )
}
