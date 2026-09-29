import { Form, Link } from '@adonisjs/inertia/react'
import { Head, router } from '@inertiajs/react'
import { useMemo, useState } from 'react'
import type React from 'react'
import {
  ClipboardPaste,
  FileText,
  ImageIcon,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react'
import { Dialog } from '~/components/ui/Dialog'
import { Menu } from '~/components/ui/Menu'
import { relativeTime } from '~/lib/format'
import { useUiStore } from '~/lib/ui'
import { useT, type MessageKey } from '~/i18n'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
  editedAt: string | null
  assetsCount: number
  coverUrl: string | null
  designDoc: {
    version: number
    status: 'queued' | 'running' | 'ready' | 'failed'
    generatedAt: string | null
  } | null
}

type SortKey = 'edited' | 'title' | 'created'

const SORTS: Record<SortKey, { label: MessageKey; compare: (a: Board, b: Board) => number }> = {
  edited: {
    label: 'boards.sort.edited',
    compare: (a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''),
  },
  title: { label: 'boards.sort.title', compare: (a, b) => a.title.localeCompare(b.title) },
  created: {
    label: 'boards.sort.created',
    compare: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  },
}

const BoardsIndex: React.FC<{ boards: Board[] }> = ({ boards }) => {
  const { t, tp, locale } = useT()
  const openCreateBoard = useUiStore((s) => s.openCreateBoard)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('edited')
  const [renaming, setRenaming] = useState<Board | null>(null)
  const [deleting, setDeleting] = useState<Board | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale)
    return boards
      .filter((b) => !q || b.title.toLocaleLowerCase(locale).includes(q))
      .sort(SORTS[sort].compare)
  }, [boards, query, sort, locale])

  return (
    <div className="page">
      <Head title={t('boards.title')} />

      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">{t('boards.title')}</h1>
          <p className="t-muted">
            {boards.length ? tp('boards.count', boards.length) : t('boards.subtitleEmpty')}
          </p>
        </div>
        {boards.length ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={openCreateBoard}
            data-testid="new-board"
          >
            <Plus />
            {t('nav.newBoard')}
          </button>
        ) : null}
      </header>

      {boards.length === 0 ? (
        <Onboarding onCreate={openCreateBoard} />
      ) : (
        <>
          <div className="filters">
            <label className="input-group">
              <span className="sr-only">{t('boards.search')}</span>
              <Search />
              <input
                className="input"
                type="search"
                placeholder={t('boards.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="boards-search"
              />
            </label>
            <label>
              <span className="sr-only">{t('boards.sort')}</span>
              <select
                className="select"
                style={{ width: 200 }}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {(Object.keys(SORTS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {t(SORTS[key].label)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Search />
              </div>
              <div className="t-body-lg">{t('boards.noResults', { query })}</div>
              <button type="button" className="btn btn--sm" onClick={() => setQuery('')}>
                {t('boards.clearSearch')}
              </button>
            </div>
          ) : (
            <div className="board-grid" data-testid="board-grid">
              {visible.map((board) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  onRename={() => setRenaming(board)}
                  onDelete={() => setDeleting(board)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <RenameDialog board={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog board={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

function DocBadge({ doc }: { doc: Board['designDoc'] }) {
  const { t } = useT()
  if (!doc) return <span className="badge badge--outline">{t('boards.doc.none')}</span>
  if (doc.status === 'ready') {
    return (
      <span className="badge badge--accent">
        <FileText />
        {t('boards.doc.ready', { version: doc.version })}
      </span>
    )
  }
  if (doc.status === 'failed') {
    return <span className="badge badge--danger">{t('boards.doc.failed')}</span>
  }
  return (
    <span className="badge">
      <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
      {t('boards.doc.running')}
    </span>
  )
}

function BoardCard({
  board,
  onRename,
  onDelete,
}: {
  board: Board
  onRename: () => void
  onDelete: () => void
}) {
  const { t, tp } = useT()
  return (
    <article className="board-card" data-testid={`board-card-${board.id}`}>
      <Link route="boards.show" routeParams={{ id: String(board.id) }} className="board-card__link">
        <div className="board-card__cover">
          {board.coverUrl ? <img src={board.coverUrl} alt="" loading="lazy" /> : <LayoutGrid />}
        </div>
        <div className="board-card__body">
          <h2 className="board-card__title t-truncate">{board.title}</h2>
          <div className="board-card__meta">
            <span>{relativeTime(board.editedAt)}</span>
            <span aria-hidden>·</span>
            <span>{tp('count.materials', board.assetsCount)}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <DocBadge doc={board.designDoc} />
          </div>
        </div>
      </Link>
      <div className="board-card__menu">
        <Menu
          label={t('boards.menu', { title: board.title })}
          testId={`board-menu-${board.id}`}
          actions={[
            {
              label: t('common.open'),
              icon: <SquareArrowOutUpRight />,
              onSelect: () => router.visit(`/boards/${board.id}`),
            },
            {
              label: t('common.rename'),
              icon: <Pencil />,
              onSelect: onRename,
              testId: 'board-rename',
            },
            {
              label: t('common.delete'),
              icon: <Trash2 />,
              onSelect: onDelete,
              danger: true,
              testId: 'board-delete',
            },
          ]}
        />
      </div>
    </article>
  )
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
  const { t } = useT()
  const steps = [
    {
      icon: <ClipboardPaste />,
      title: t('boards.onboarding.step1.title'),
      text: t('boards.onboarding.step1.text'),
    },
    {
      icon: <ImageIcon />,
      title: t('boards.onboarding.step2.title'),
      text: t('boards.onboarding.step2.text'),
    },
    {
      icon: <Sparkles />,
      title: t('boards.onboarding.step3.title'),
      text: t('boards.onboarding.step3.text'),
    },
  ]
  return (
    <div className="empty-state" data-testid="boards-empty">
      <div className="empty-state__icon">
        <LayoutGrid />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="t-title">{t('boards.onboarding.title')}</div>
        <p className="t-muted">{t('boards.onboarding.subtitle')}</p>
      </div>
      <div
        className="steps"
        style={{ width: '100%', maxWidth: 720, margin: '8px 0', textAlign: 'left' }}
      >
        {steps.map((step, i) => (
          <div key={step.title} className="card card--outlined step">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="step__num">{i + 1}</span>
              <span style={{ fontWeight: 500 }}>{step.title}</span>
            </div>
            <p className="t-muted t-small">{step.text}</p>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--primary btn--lg"
        onClick={onCreate}
        data-testid="new-board"
      >
        <Plus />
        {t('nav.newBoard')}
      </button>
    </div>
  )
}

function RenameDialog({ board, onClose }: { board: Board | null; onClose: () => void }) {
  const { t } = useT()
  return (
    <Dialog
      open={Boolean(board)}
      onClose={onClose}
      title={t('boards.rename.title')}
      testId="rename-board-dialog"
    >
      {board ? (
        <Form
          route="boards.update"
          routeParams={{ id: String(board.id) }}
          method="patch"
          onSuccess={onClose}
        >
          {({ errors, processing }: { errors: Record<string, string>; processing: boolean }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="field">
                <label className="field__label" htmlFor="rename-title">
                  {t('common.name')}
                </label>
                <input
                  id="rename-title"
                  name="title"
                  className="input"
                  defaultValue={board.title}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  maxLength={255}
                  aria-invalid={errors.title ? 'true' : undefined}
                />
                {errors.title ? <div className="field__error">{errors.title}</div> : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
        </Form>
      ) : null}
    </Dialog>
  )
}

function DeleteDialog({ board, onClose }: { board: Board | null; onClose: () => void }) {
  const { t, tp } = useT()
  return (
    <Dialog
      open={Boolean(board)}
      onClose={onClose}
      title={t('boards.delete.title')}
      testId="delete-board-dialog"
      description={
        board
          ? t('boards.delete.body', {
              title: board.title,
              count: tp('count.materials', board.assetsCount),
            })
          : null
      }
    >
      {board ? (
        <Form
          route="boards.destroy"
          routeParams={{ id: String(board.id) }}
          method="delete"
          onSuccess={onClose}
        >
          {({ processing }: { processing: boolean }) => (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose} autoFocus>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn--danger-solid"
                disabled={processing}
                data-testid="confirm-delete-board"
              >
                <Trash2 />
                {t('boards.delete.submit')}
              </button>
            </div>
          )}
        </Form>
      ) : null}
    </Dialog>
  )
}

export default BoardsIndex
