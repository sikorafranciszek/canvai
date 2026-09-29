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
import { plural, relativeTime } from '~/lib/format'
import { useUiStore } from '~/lib/ui'

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

const SORTS: Record<SortKey, { label: string; compare: (a: Board, b: Board) => number }> = {
  edited: {
    label: 'Ostatnio edytowane',
    compare: (a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? ''),
  },
  title: { label: 'Nazwa A–Z', compare: (a, b) => a.title.localeCompare(b.title, 'pl') },
  created: {
    label: 'Najnowsze',
    compare: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  },
}

const BoardsIndex: React.FC<{ boards: Board[] }> = ({ boards }) => {
  const openCreateBoard = useUiStore((s) => s.openCreateBoard)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('edited')
  const [renaming, setRenaming] = useState<Board | null>(null)
  const [deleting, setDeleting] = useState<Board | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pl')
    return boards
      .filter((b) => !q || b.title.toLocaleLowerCase('pl').includes(q))
      .sort(SORTS[sort].compare)
  }, [boards, query, sort])

  return (
    <div className="page">
      <Head title="Tablice" />

      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">Tablice</h1>
          <p className="t-muted">
            {boards.length
              ? `${plural(boards.length, 'tablica', 'tablice', 'tablic')} w Twojej przestrzeni`
              : 'Zbieraj materiały klienta i generuj z nich specyfikację DESIGN.md.'}
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
            Nowa tablica
          </button>
        ) : null}
      </header>

      {boards.length === 0 ? (
        <Onboarding onCreate={openCreateBoard} />
      ) : (
        <>
          <div className="filters">
            <label className="input-group">
              <span className="sr-only">Szukaj tablic</span>
              <Search />
              <input
                className="input"
                type="search"
                placeholder="Szukaj po nazwie…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="boards-search"
              />
            </label>
            <label>
              <span className="sr-only">Sortowanie</span>
              <select
                className="select"
                style={{ width: 200 }}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {Object.entries(SORTS).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
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
              <div className="t-body-lg">Brak wyników dla „{query}”</div>
              <button type="button" className="btn btn--sm" onClick={() => setQuery('')}>
                Wyczyść wyszukiwanie
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
  if (!doc) return <span className="badge badge--outline">Bez DESIGN.md</span>
  if (doc.status === 'ready') {
    return (
      <span className="badge badge--accent">
        <FileText />
        DESIGN.md v{doc.version}
      </span>
    )
  }
  if (doc.status === 'failed') return <span className="badge badge--danger">Błąd generacji</span>
  return (
    <span className="badge">
      <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
      Generowanie
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
            <span>{plural(board.assetsCount, 'materiał', 'materiały', 'materiałów')}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <DocBadge doc={board.designDoc} />
          </div>
        </div>
      </Link>
      <div className="board-card__menu">
        <Menu
          label={`Akcje tablicy ${board.title}`}
          testId={`board-menu-${board.id}`}
          actions={[
            {
              label: 'Otwórz',
              icon: <SquareArrowOutUpRight />,
              onSelect: () => router.visit(`/boards/${board.id}`),
            },
            { label: 'Zmień nazwę', icon: <Pencil />, onSelect: onRename, testId: 'board-rename' },
            {
              label: 'Usuń',
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
  const steps = [
    {
      icon: <ClipboardPaste />,
      title: 'Wklej materiały',
      text: 'Zrzuty ekranu (Ctrl+V), logo, inspiracje, PDF-y i linki do stron referencyjnych.',
    },
    {
      icon: <ImageIcon />,
      title: 'Ułóż i opisz',
      text: 'Pogrupuj ramkami, połącz ekrany strzałkami, dodaj notatki „co to jest”.',
    },
    {
      icon: <Sparkles />,
      title: 'Wygeneruj DESIGN.md',
      text: 'AI napisze specyfikację: ekrany, komponenty, tokeny — gotową dla AI budującego UI.',
    },
  ]
  return (
    <div className="empty-state" data-testid="boards-empty">
      <div className="empty-state__icon">
        <LayoutGrid />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="t-title">Utwórz pierwszą tablicę</div>
        <p className="t-muted">Trzy kroki od materiałów klienta do specyfikacji interfejsu.</p>
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
        Nowa tablica
      </button>
    </div>
  )
}

function RenameDialog({ board, onClose }: { board: Board | null; onClose: () => void }) {
  return (
    <Dialog
      open={Boolean(board)}
      onClose={onClose}
      title="Zmień nazwę tablicy"
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
                  Nazwa
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
                  Anuluj
                </button>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  Zapisz
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
  return (
    <Dialog
      open={Boolean(board)}
      onClose={onClose}
      title="Usunąć tablicę?"
      testId="delete-board-dialog"
      description={
        board ? (
          <>
            Tablica{' '}
            <strong style={{ color: 'var(--color-ink)', fontWeight: 500 }}>„{board.title}”</strong>{' '}
            zostanie usunięta razem z{' '}
            {plural(board.assetsCount, 'materiałem', 'materiałami', 'materiałami')} i wszystkimi
            wersjami DESIGN.md. Tej operacji nie można cofnąć.
          </>
        ) : null
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
                Anuluj
              </button>
              <button
                type="submit"
                className="btn btn--danger-solid"
                disabled={processing}
                data-testid="confirm-delete-board"
              >
                <Trash2 />
                Usuń tablicę
              </button>
            </div>
          )}
        </Form>
      ) : null}
    </Dialog>
  )
}

export default BoardsIndex
