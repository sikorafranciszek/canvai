import { Link } from '@adonisjs/inertia/react'
import { useEffect, useState } from 'react'
import type React from 'react'
import { SaveStatus } from '~/components/canvas/SaveStatus'
import { GenerateDesignDocButton, SidePanel } from '~/components/design/SidePanel'
import { useDesignStore } from '~/lib/board/design'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
}

const BoardsShow: React.FC<{ board: Board }> = ({ board }) => {
  // react-konva wymaga przeglądarki (canvas). Render dopiero po stronie klienta —
  // w SSR pokazujemy stan ładowania.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Stan DESIGN.md (wersje, generacja w toku) — niezależny od silnika płótna.
  useEffect(() => {
    const design = useDesignStore.getState()
    void design.init(board.id)
    return () => design.dispose()
  }, [board.id])

  const [Canvas, setCanvas] = useState<React.ComponentType<{ boardId: number }> | null>(null)
  const [Toolbar, setToolbar] = useState<React.ComponentType | null>(null)

  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    Promise.all([import('~/components/canvas/Canvas'), import('~/components/canvas/Toolbar')]).then(
      ([canvasMod, toolbarMod]) => {
        if (cancelled) return
        setCanvas(() => canvasMod.Canvas)
        setToolbar(() => toolbarMod.Toolbar)
      }
    )
    return () => {
      cancelled = true
    }
  }, [mounted])

  return (
    // Wysokość = widok minus nagłówek layoutu (64px + obramowanie `main`).
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 67px)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px',
          height: 48,
          borderBottom: '1px solid #e2e8f0',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: 16 }} data-testid="board-title">
            {board.title}
          </h1>
          <SaveStatus />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <GenerateDesignDocButton />
          <Link route="boards.index" className="button" style={{ fontSize: 13 }}>
            Back to Boards
          </Link>
        </div>
      </div>

      {Toolbar ? <Toolbar /> : null}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', background: '#f8fafc', minWidth: 0 }}>
          {Canvas ? (
            <Canvas key={board.id} boardId={board.id} />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#64748b',
              }}
              data-testid="canvas-loading"
            >
              Ładowanie edytora…
            </div>
          )}
        </div>

        <SidePanel />
      </div>
    </div>
  )
}

export default BoardsShow
