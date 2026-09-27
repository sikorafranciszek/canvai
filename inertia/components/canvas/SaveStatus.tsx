/**
 * Wskaźnik stanu autosave: „zapisywanie / zapisano / błąd zapisu”.
 */
import { useBoardStore, type BoardSaveStatus } from '~/lib/board/session'

const LABELS: Record<BoardSaveStatus, string> = {
  loading: 'Ładowanie…',
  idle: 'Zapisano',
  dirty: 'Zmiany…',
  saving: 'Zapisywanie…',
  saved: 'Zapisano',
  error: 'Błąd zapisu',
}

const COLORS: Record<BoardSaveStatus, string> = {
  loading: '#94a3b8',
  idle: '#64748b',
  dirty: '#94a3b8',
  saving: '#2563eb',
  saved: '#16a34a',
  error: '#dc2626',
}

export function SaveStatus() {
  const status = useBoardStore((s) => s.saveStatus)

  return (
    <span
      data-testid="save-status"
      data-status={status}
      style={{ fontSize: 12, color: COLORS[status] }}
      title="Stan zapisu tablicy"
    >
      {LABELS[status]}
    </span>
  )
}
