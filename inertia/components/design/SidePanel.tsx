/**
 * Prawy panel tablicy z zakładkami „Materiały” i „DESIGN.md” + przycisk
 * generacji używany w górnym pasku edytora.
 */
import { Sparkles } from 'lucide-react'
import { AssetPanel } from '~/components/canvas/AssetPanel'
import { DesignDocPanel } from '~/components/design/DesignDocPanel'
import { useDesignStore, type SidePanelTab } from '~/lib/board/design'
import { useBoardStore } from '~/lib/board/session'

const WIDTH: Record<SidePanelTab, number> = { assets: 320, design: 480 }

export function SidePanel({ open = true }: { open?: boolean }) {
  const tab = useDesignStore((s) => s.tab)
  const setTab = useDesignStore((s) => s.setTab)
  const pending = useDesignStore((s) => Boolean(s.active))
  const latest = useDesignStore((s) => s.versions.find((v) => v.status === 'ready'))
  const assetCount = useBoardStore((s) => s.assets.length)
  const width = WIDTH[tab]

  return (
    // Zewnętrzna „szuflada” animuje szerokość; treść ma stałą szerokość i jest
    // zakotwiczona do lewej krawędzi szuflady, więc wjeżdża z prawej krawędzi
    // ekranu. Po zamknięciu panel zostaje zamontowany (inert) — zachowuje stan.
    <div
      className="side-drawer"
      data-open={open}
      style={{ width: open ? width : 0 }}
      inert={!open}
      aria-hidden={!open}
    >
    <aside
      className="side-panel"
      data-testid="side-panel"
      aria-label="Panel boczny"
      style={{ width, minWidth: width }}
    >
      <div className="side-panel__tabs" role="tablist" aria-label="Widok panelu">
        <button
          type="button"
          role="tab"
          className="chip"
          aria-selected={tab === 'assets'}
          data-testid="tab-assets"
          onClick={() => setTab('assets')}
        >
          Materiały
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
              aria-label="generowanie"
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
  const generate = useDesignStore((s) => s.generate)
  const starting = useDesignStore((s) => s.starting)
  const pending = useDesignStore((s) => Boolean(s.active))
  const busy = starting || pending

  return (
    <button
      type="button"
      className="btn btn--primary btn--sm"
      style={{ height: 32 }}
      data-testid="generate-design-doc"
      onClick={() => void generate()}
      disabled={busy}
      aria-busy={busy}
      title="AI przeanalizuje materiały z tablicy i napisze specyfikację DESIGN.md"
    >
      {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Sparkles />}
      {busy ? 'Generowanie…' : 'Generuj DESIGN.md'}
    </button>
  )
}
