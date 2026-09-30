/**
 * Portal klienta tablicy: włączenie linku, kopiowanie, opcje (przesyłanie
 * materiałów, podgląd DESIGN.md do akceptacji), nowy link i decyzje klienta.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { router } from '@inertiajs/react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  MessageSquare,
  MessageSquareWarning,
  RefreshCw,
  Share2,
} from 'lucide-react'
import { Dialog } from '~/components/ui/Dialog'
import { csrfHeaders } from '~/lib/board/api'
import { relativeTime } from '~/lib/format'
import { useT } from '~/i18n'

interface ShareState {
  allowed: boolean
  enabled: boolean
  url: string | null
  allowUpload: boolean
  showDoc: boolean
  feedback: {
    id: number
    decision: 'approved' | 'changes' | 'note'
    version: number | null
    name: string
    comment: string | null
    createdAt: string | null
  }[]
}

async function request(boardId: number, method: 'GET' | 'PUT' | 'POST', path = '', body?: unknown) {
  const res = await fetch(`/api/boards/${boardId}/share${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...csrfHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { data?: ShareState; message?: string }
  if (!res.ok || !json.data) throw new Error(json.message ?? `HTTP ${res.status}`)
  return json.data
}

export function ShareButton({ boardId }: { boardId: number }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        style={{ height: 32 }}
        onClick={() => setOpen(true)}
        data-testid="share-board"
      >
        <Share2 />
        {t('share.button')}
      </button>
      <ShareDialog boardId={boardId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function ShareDialog({
  boardId,
  open,
  onClose,
}: {
  boardId: number
  open: boolean
  onClose: () => void
}) {
  const { t } = useT()
  const [state, setState] = useState<ShareState | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (fn: () => Promise<ShareState>) => {
      setBusy(true)
      try {
        setState(await fn())
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('share.failed'))
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (open) void run(() => request(boardId, 'GET'))
  }, [open, boardId, run])

  const update = (patch: Partial<Pick<ShareState, 'enabled' | 'allowUpload' | 'showDoc'>>) =>
    run(() =>
      request(boardId, 'PUT', '', {
        enabled: patch.enabled ?? state?.enabled ?? false,
        allowUpload: patch.allowUpload ?? state?.allowUpload,
        showDoc: patch.showDoc ?? state?.showDoc,
      })
    )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('share.title')}
      description={t('share.desc')}
      testId="share-dialog"
    >
      {!state ? (
        <div className="skeleton" style={{ height: 80 }} />
      ) : !state.allowed ? (
        <div className="alert alert--notice" data-testid="share-locked">
          <Lock />
          <span style={{ flex: 1 }}>{t('share.locked')}</span>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => router.visit('/billing')}
          >
            {t('billing.upgrade')}
          </button>
        </div>
      ) : (
        <div className="share">
          <label className="share__toggle">
            <input
              type="checkbox"
              className="switch"
              checked={state.enabled}
              disabled={busy}
              onChange={(e) => void update({ enabled: e.target.checked })}
              data-testid="share-toggle"
            />
            <span>{state.enabled ? t('share.on') : t('share.off')}</span>
          </label>

          {state.enabled && state.url ? (
            <>
              <div className="copy-field">
                <input
                  className="input"
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="share-url"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(state.url!).catch(() => {})
                    toast.success(t('share.copied'))
                  }}
                >
                  <Copy />
                  {t('common.copy')}
                </button>
                <a
                  className="btn btn--icon"
                  href={state.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('share.open')}
                >
                  <ExternalLink />
                </a>
              </div>
              <label className="share__option">
                <input
                  type="checkbox"
                  checked={state.allowUpload}
                  disabled={busy}
                  onChange={(e) => void update({ allowUpload: e.target.checked })}
                />
                {t('share.allowUpload')}
              </label>
              <label className="share__option">
                <input
                  type="checkbox"
                  checked={state.showDoc}
                  disabled={busy}
                  onChange={(e) => void update({ showDoc: e.target.checked })}
                />
                {t('share.showDoc')}
              </label>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                style={{ alignSelf: 'flex-start' }}
                disabled={busy}
                onClick={() => void run(() => request(boardId, 'POST', '/rotate'))}
              >
                <RefreshCw />
                {t('share.rotate')}
              </button>
            </>
          ) : null}

          {state.feedback.length ? (
            <div className="share__feedback">
              <span className="field__label">{t('share.feedback')}</span>
              <ul>
                {state.feedback.map((f) => (
                  <li key={f.id} data-testid="share-feedback-item">
                    {f.decision === 'approved' ? (
                      <CheckCircle2 size={16} className="share__ok" />
                    ) : f.decision === 'changes' ? (
                      <MessageSquareWarning size={16} className="share__warn" />
                    ) : (
                      <MessageSquare size={16} />
                    )}
                    <div>
                      <strong>{f.name}</strong>{' '}
                      <span className="t-muted">
                        {t(`share.decision.${f.decision}`, { version: f.version ?? '' })} ·{' '}
                        {relativeTime(f.createdAt)}
                      </span>
                      {f.comment ? <p className="t-small">„{f.comment}”</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
