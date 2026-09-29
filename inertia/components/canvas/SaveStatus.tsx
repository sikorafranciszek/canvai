/**
 * Wskaźnik stanu autosave: „zapisywanie / zapisano / błąd zapisu”.
 */
import { AlertCircle, Check, CloudUpload } from 'lucide-react'
import { useBoardStore, type BoardSaveStatus } from '~/lib/board/session'

const LABELS: Record<BoardSaveStatus, string> = {
  loading: 'Wczytywanie…',
  idle: 'Zapisano',
  dirty: 'Zapisywanie…',
  saving: 'Zapisywanie…',
  saved: 'Zapisano',
  error: 'Błąd zapisu',
}

export function SaveStatus() {
  const status = useBoardStore((s) => s.saveStatus)

  const icon =
    status === 'saving' || status === 'loading' ? (
      <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
    ) : status === 'error' ? (
      <AlertCircle />
    ) : status === 'dirty' ? (
      <CloudUpload />
    ) : (
      <Check />
    )

  return (
    <span
      className="save-status"
      data-testid="save-status"
      data-status={status}
      role="status"
      aria-live="polite"
      title={
        status === 'error'
          ? 'Zmiany zostaną zapisane ponownie przy następnej edycji'
          : 'Stan zapisu tablicy'
      }
    >
      {icon}
      {LABELS[status]}
    </span>
  )
}
