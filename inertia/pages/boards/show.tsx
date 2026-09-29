import { Link } from '@adonisjs/inertia/react'
import { Head, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { ArrowLeft, PanelRight } from 'lucide-react'
import { SaveStatus } from '~/components/canvas/SaveStatus'
import { GenerateDesignDocButton, SidePanel } from '~/components/design/SidePanel'
import { useDesignStore } from '~/lib/board/design'
import { useUiStore } from '~/lib/ui'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
}

type SharedUser = { fullName: string | null; email: string; initials: string }

const BoardsShow: React.FC<{ board: Board; user?: SharedUser }> = ({ board, user }) => {
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

  const sidePanelOpen = useUiStore((s) => s.sidePanelOpen)
  const toggleSidePanel = useUiStore((s) => s.toggleSidePanel)

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
    <div className="editor">
      <Head title={board.title} />
      <header className="topbar">
        <div className="topbar__title">
          <Link
            route="boards.index"
            className="btn btn--quiet btn--icon btn--sm"
            aria-label="Wróć do tablic"
            data-tip="Tablice"
          >
            <ArrowLeft />
          </Link>
          <Link route="boards.index" className="topbar__crumb">
            Tablice
          </Link>
          <span className="topbar__sep" aria-hidden>
            /
          </span>
          <BoardTitle key={board.title} board={board} />
          <SaveStatus />
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--quiet btn--icon btn--sm"
            onClick={toggleSidePanel}
            aria-pressed={sidePanelOpen}
            aria-label={sidePanelOpen ? 'Ukryj panel boczny' : 'Pokaż panel boczny'}
            data-tip={sidePanelOpen ? 'Ukryj panel' : 'Pokaż panel'}
            data-testid="toggle-side-panel"
          >
            <PanelRight />
          </button>
          <GenerateDesignDocButton />
          {user ? (
            <span className="avatar" title={user.fullName ?? user.email} aria-hidden>
              {user.initials}
            </span>
          ) : null}
        </div>
      </header>

      <div className="workspace">
        <div className="canvas-area">
          {Canvas ? (
            <Canvas key={board.id} boardId={board.id} />
          ) : (
            <div className="canvas-loading" data-testid="canvas-loading">
              <span className="spinner" />
              Ładowanie edytora…
            </div>
          )}
          {Toolbar ? <Toolbar /> : null}
        </div>

        {sidePanelOpen ? <SidePanel /> : null}
      </div>
    </div>
  )
}

/** Nazwa tablicy edytowalna w miejscu (Enter zapisuje, Esc anuluje). */
function BoardTitle({ board }: { board: Board }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(board.title)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = () => {
    const title = value.trim()
    setEditing(false)
    if (!title || title === board.title) {
      setValue(board.title)
      return
    }
    router.patch(`/boards/${board.id}`, { title }, { preserveState: true, preserveScroll: true })
  }

  if (editing) {
    return (
      <input
        ref={input}
        className="title-edit"
        value={value}
        maxLength={255}
        aria-label="Nazwa tablicy"
        data-testid="board-title-input"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setValue(board.title)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="title-edit t-truncate"
      onClick={() => setEditing(true)}
      data-testid="board-title"
      title="Kliknij, aby zmienić nazwę"
    >
      {board.title}
    </button>
  )
}

export default BoardsShow
