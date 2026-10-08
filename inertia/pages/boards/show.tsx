import { Link } from '@adonisjs/inertia/react'
import { Head, router } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { ArrowLeft, PanelRight } from 'lucide-react'
import { SaveStatus } from '~/components/canvas/SaveStatus'
import { GenerateDesignDocButton, SidePanel } from '~/components/design/SidePanel'
import { ShareButton } from '~/components/boards/ShareDialog'
import { BrandKitMenu } from '~/components/boards/BrandKitMenu'
import { useDesignStore, useEstimateSync } from '~/lib/board/design'
import { useBillingStore } from '~/lib/billing'
import { useUiStore } from '~/lib/ui'
import { useT } from '~/i18n'
import { LanguageSwitcher } from '~/components/ui/LanguageSwitcher'
import { useLiveStore } from '~/lib/board/live'
import {
  CommentsButton,
  CommentsLayer,
  CursorsLayer,
  MembersButton,
  PresenceAvatars,
} from '~/components/collab/Collab'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
  role?: 'owner' | 'editor' | 'viewer'
  isSample?: boolean
}

type SharedUser = { id?: number; fullName: string | null; email: string; initials: string }

const BoardsShow: React.FC<{ board: Board; user?: SharedUser; emailUnverified?: boolean }> = ({
  board,
  user,
  emailUnverified,
}) => {
  // react-konva wymaga przeglądarki (canvas). Render dopiero po stronie klienta —
  // w SSR pokazujemy stan ładowania.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Stan DESIGN.md (wersje, generacja w toku) — niezależny od silnika płótna.
  useEffect(() => {
    const design = useDesignStore.getState()
    void design.init(board.id, { sample: Boolean(board.isSample) })
    return () => design.dispose()
  }, [board.id, board.isSample])

  // Współpraca na żywo: zdarzenia tablicy, obecność, kursory.
  useEffect(() => {
    useLiveStore.getState().connect(board.id)
    return () => useLiveStore.getState().disconnect()
  }, [board.id])
  const role = board.role ?? 'owner'
  const readOnly = role === 'viewer'

  // Koszt następnej generacji i saldo (plan decyduje o trybie Pro i eksportach).
  useEstimateSync()
  useEffect(() => {
    void useBillingStore.getState().load()
  }, [])

  const sidePanelOpen = useUiStore((s) => s.sidePanelOpen)
  const { t } = useT()
  const toggleSidePanel = useUiStore((s) => s.toggleSidePanel)

  const [Canvas, setCanvas] = useState<React.ComponentType<{
    boardId: number
    readOnly?: boolean
  }> | null>(null)
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
            aria-label={t('editor.back')}
            data-tip={t('nav.boards')}
          >
            <ArrowLeft />
          </Link>
          <Link route="boards.index" className="topbar__crumb">
            {t('nav.boards')}
          </Link>
          <span className="topbar__sep" aria-hidden>
            /
          </span>
          {role === 'owner' ? (
            <BoardTitle key={board.title} board={board} />
          ) : (
            <span className="title-edit t-truncate">{board.title}</span>
          )}
          {readOnly ? (
            <span className="badge badge--outline" data-testid="readonly-badge">
              {t('members.viewerBadge')}
            </span>
          ) : (
            <SaveStatus />
          )}
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--quiet btn--icon btn--sm"
            onClick={toggleSidePanel}
            aria-pressed={sidePanelOpen}
            aria-label={sidePanelOpen ? t('editor.panel.hideLabel') : t('editor.panel.showLabel')}
            data-tip={sidePanelOpen ? t('editor.panel.hide') : t('editor.panel.show')}
            data-testid="toggle-side-panel"
          >
            <PanelRight />
          </button>
          <PresenceAvatars selfId={user?.id} />
          <LanguageSwitcher compact />
          <CommentsButton />
          {readOnly ? null : <BrandKitMenu />}
          <MembersButton boardId={board.id} isOwner={role === 'owner'} />
          {role === 'owner' ? <ShareButton boardId={board.id} /> : null}
          {readOnly ? null : <GenerateDesignDocButton />}
          {user ? (
            <span className="avatar" title={user.fullName ?? user.email} aria-hidden>
              {user.initials}
            </span>
          ) : null}
        </div>
      </header>

      {emailUnverified ? (
        <div className="unverified-banner" role="status" data-testid="unverified-banner">
          {t('board.unverifiedBanner')}
          <Link href="/verify-email" className="link-button">
            {t('auth.verify.title')}
          </Link>
        </div>
      ) : null}
      <div className="workspace" data-clarity-mask="true">
        <div className="canvas-area">
          {Canvas ? (
            <Canvas key={board.id} boardId={board.id} readOnly={readOnly} />
          ) : (
            <div className="canvas-loading" data-testid="canvas-loading">
              <span className="spinner" />
              {t('editor.loading')}
            </div>
          )}
          {Toolbar && !readOnly ? <Toolbar /> : null}
          {Canvas ? <CommentsLayer boardId={board.id} /> : null}
          {Canvas ? <CursorsLayer /> : null}
        </div>

        <SidePanel open={sidePanelOpen} />
      </div>
    </div>
  )
}

/** Nazwa tablicy edytowalna w miejscu (Enter zapisuje, Esc anuluje). */
function BoardTitle({ board }: { board: Board }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(board.title)
  const input = useRef<HTMLInputElement>(null)
  const { t } = useT()

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
        aria-label={t('editor.titleLabel')}
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
      title={t('editor.titleEdit')}
    >
      {board.title}
    </button>
  )
}

export default BoardsShow
