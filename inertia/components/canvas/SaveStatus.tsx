/**
 * Wskaźnik stanu autosave: „zapisywanie / zapisano / błąd zapisu”.
 */
import { AlertCircle, Check, CloudUpload } from 'lucide-react'
import { useBoardStore, type BoardSaveStatus } from '~/lib/board/session'
import { useT, type MessageKey } from '~/i18n'

const LABELS: Record<BoardSaveStatus, MessageKey> = {
  loading: 'save.loading',
  idle: 'save.saved',
  dirty: 'save.saving',
  saving: 'save.saving',
  saved: 'save.saved',
  error: 'save.error',
}

export function SaveStatus() {
  const status = useBoardStore((s) => s.saveStatus)
  const { t } = useT()

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
      title={status === 'error' ? t('save.errorHint') : t('save.hint')}
    >
      {icon}
      {t(LABELS[status])}
    </span>
  )
}
