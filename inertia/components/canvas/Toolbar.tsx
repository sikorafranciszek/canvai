import { useSceneStore } from '~/lib/scene/store'
import { TOOLS, toolTestId } from '@shared/tools'

export function Toolbar() {
  const tool = useSceneStore((s) => s.tool)
  const setTool = useSceneStore((s) => s.setTool)
  const canUndo = useSceneStore((s) => s.canUndo)
  const canRedo = useSceneStore((s) => s.canRedo)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)

  const fitToContent = () => {
    const { document, setCamera } = useSceneStore.getState()
    const els = document.elements
    if (els.length === 0) {
      setCamera({ x: 0, y: 0, scale: 1 })
      return
    }

    const xs: number[] = []
    const ys: number[] = []
    for (const el of els) {
      xs.push(el.x)
      ys.push(el.y)
      if ('width' in el && 'height' in el && typeof el.width === 'number' && typeof el.height === 'number') {
        xs.push(el.x + el.width)
        ys.push(el.y + el.height)
      } else if ('points' in el && Array.isArray(el.points)) {
        for (const p of el.points) {
          xs.push(el.x + p.x)
          ys.push(el.y + p.y)
        }
      }
    }

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const contentW = Math.max(1, maxX - minX)
    const contentH = Math.max(1, maxY - minY)

    const padding = 80
    const availW = Math.max(1, window.innerWidth - padding * 2)
    const availH = Math.max(1, window.innerHeight - 160 - padding * 2)
    const scale = Math.min(availW / contentW, availH / contentH, 2)

    setCamera({
      x: (window.innerWidth - contentW * scale) / 2 - minX * scale,
      y: (window.innerHeight - 160 - contentH * scale) / 2 - minY * scale,
      scale,
    })
  }

  const resetView = () => {
    useSceneStore.getState().setCamera({ x: 0, y: 0, scale: 1 })
  }

  return (
    <div
      data-testid="toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 12px',
        borderBottom: '1px solid #e2e8f0',
        background: '#fff',
        flexWrap: 'wrap',
      }}
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          data-testid={toolTestId(t.id)}
          title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
          onClick={() => setTool(t.id)}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: tool === t.id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            background: tool === t.id ? '#eff6ff' : '#fff',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {t.label}
        </button>
      ))}

      <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 6px' }} />

      <button data-testid="undo" onClick={undo} disabled={!canUndo} style={btnStyle(!canUndo)} title="Ctrl+Z">
        ↩
      </button>
      <button data-testid="redo" onClick={redo} disabled={!canRedo} style={btnStyle(!canRedo)} title="Ctrl+Shift+Z">
        ↪
      </button>
      <button data-testid="fit-to-content" onClick={fitToContent} style={btnStyle(false)} title="Dopasuj do zawartości">
        ⤢
      </button>
      <button data-testid="reset-view" onClick={resetView} style={btnStyle(false)} title="Reset widoku">
        100%
      </button>
    </div>
  )
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    background: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontSize: 13,
  }
}
