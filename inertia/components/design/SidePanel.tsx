/**
 * Prawy panel tablicy z zakładkami „Assety” i „DESIGN.md”.
 */
import type React from 'react'
import { AssetPanel } from '~/components/canvas/AssetPanel'
import { DesignDocPanel } from '~/components/design/DesignDocPanel'
import { useDesignStore, type SidePanelTab } from '~/lib/board/design'
import { useBoardStore } from '~/lib/board/session'

const WIDTH: Record<SidePanelTab, number> = { assets: 304, design: 460 }

export function SidePanel() {
  const tab = useDesignStore((s) => s.tab)
  const setTab = useDesignStore((s) => s.setTab)
  const pending = useDesignStore((s) => Boolean(s.active))
  const assetCount = useBoardStore((s) => s.assets.length)

  const tabStyle = (id: SidePanelTab): React.CSSProperties => ({
    flex: 1,
    padding: '9px 8px',
    fontSize: 13,
    fontWeight: tab === id ? 600 : 400,
    color: tab === id ? '#0f172a' : '#64748b',
    background: 'transparent',
    border: 0,
    borderBottom: `2px solid ${tab === id ? '#4f46e5' : 'transparent'}`,
    cursor: 'pointer',
  })

  return (
    <aside
      data-testid="side-panel"
      style={{
        width: WIDTH[tab],
        minWidth: WIDTH[tab],
        borderLeft: '1px solid #e2e8f0',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'assets'}
          data-testid="tab-assets"
          onClick={() => setTab('assets')}
          style={tabStyle('assets')}
        >
          Assety ({assetCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'design'}
          data-testid="tab-design"
          onClick={() => setTab('design')}
          style={tabStyle('design')}
        >
          DESIGN.md{pending ? ' •' : ''}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'assets' ? <AssetPanel /> : <DesignDocPanel />}
      </div>
    </aside>
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
      data-testid="generate-design-doc"
      onClick={() => void generate()}
      disabled={busy}
      title="AI przeanalizuje materiały z tablicy i napisze specyfikację DESIGN.md"
      style={{
        fontSize: 13,
        fontWeight: 600,
        padding: '6px 12px',
        borderRadius: 8,
        border: 0,
        background: busy ? '#a5b4fc' : '#4f46e5',
        color: '#fff',
        cursor: busy ? 'progress' : 'pointer',
      }}
    >
      {busy ? 'Generowanie…' : '✦ Generuj DESIGN.md'}
    </button>
  )
}
