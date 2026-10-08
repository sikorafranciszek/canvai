/**
 * Repozytorium GitHub tablicy (FEAT-5): połączenie fine-grained tokenem i pull
 * request z DESIGN.md, tokenami, regułą Cursora i CLAUDE.md — automatycznie po
 * akceptacji wersji albo na żądanie.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import { csrfHeaders } from '~/lib/board/api'
import { httpError, notifyError } from '~/lib/errors'
import { formatDateTime } from '~/lib/format'
import { useT } from '~/i18n'

interface RepoDto {
  repo: string
  baseBranch: string
  directory: string
  autoOnApprove: boolean
  lastVersion: number | null
  lastPrUrl: string | null
  lastError: string | null
  lastSyncedAt: string | null
}

const jsonHeaders = () => ({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  ...csrfHeaders(),
})

export function GithubRepoPanel({ boardId, allowed }: { boardId: number; allowed: boolean }) {
  const { t } = useT()
  const [repo, setRepo] = useState<RepoDto | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({
    repo: '',
    token: '',
    baseBranch: '',
    directory: '',
    autoOnApprove: true,
  })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/boards/${boardId}/repo`, { credentials: 'same-origin' })
    const data = res.ok ? ((await res.json()) as { data: RepoDto | null }).data : null
    setRepo(data)
    if (data) {
      setForm({
        repo: data.repo,
        token: '',
        baseBranch: data.baseBranch,
        directory: data.directory,
        autoOnApprove: data.autoOnApprove,
      })
    }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
  }, [boardId])

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/repo`, {
        method: 'PUT',
        headers: jsonHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
          repo: form.repo.trim(),
          ...(form.token.trim() ? { token: form.token.trim() } : {}),
          ...(form.baseBranch.trim() ? { baseBranch: form.baseBranch.trim() } : {}),
          directory: form.directory.trim(),
          autoOnApprove: form.autoOnApprove,
        }),
      })
      if (!res.ok) throw await httpError(res, t('github.saveFailed'))
      const data = ((await res.json()) as { data: RepoDto }).data
      setRepo(data)
      setForm((f) => ({ ...f, token: '', baseBranch: data.baseBranch }))
      toast.success(t('github.saved', { repo: data.repo }))
    } catch (error) {
      notifyError(error, 'github.saveFailed')
    } finally {
      setBusy(false)
    }
  }

  const sync = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/boards/${boardId}/repo/sync`, {
        method: 'POST',
        headers: jsonHeaders(),
        credentials: 'same-origin',
        body: '{}',
      })
      if (!res.ok) throw await httpError(res, t('github.syncFailed'))
      const { version } = ((await res.json()) as { data: { version: number } }).data
      toast.info(t('github.syncStarted', { version }))
      // Zadanie w kolejce trwa kilka sekund — odświeżamy status.
      setTimeout(() => void load(), 4000)
    } catch (error) {
      notifyError(error, 'github.syncFailed')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm(t('github.disconnectConfirm', { repo: repo?.repo ?? '' }))) return
    await fetch(`/api/boards/${boardId}/repo`, {
      method: 'DELETE',
      headers: jsonHeaders(),
      credentials: 'same-origin',
    })
    setRepo(null)
    setForm({ repo: '', token: '', baseBranch: '', directory: '', autoOnApprove: true })
  }

  if (!loaded) return <p className="t-small t-muted">{t('common.loading')}</p>
  const field = (key: 'repo' | 'token' | 'baseBranch' | 'directory', extra = {}) => (
    <div className="field">
      <label className="field__label" htmlFor={`gh-${key}`}>
        {t(`github.field.${key}`)}
      </label>
      <input
        className="input input--sm"
        id={`gh-${key}`}
        data-testid={`github-${key}`}
        value={form[key]}
        disabled={!allowed}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...extra}
      />
    </div>
  )

  return (
    <div className="github-panel" data-testid="github-panel">
      {repo?.lastError ? (
        <div className="alert alert--danger" role="alert" data-testid="github-error">
          {repo.lastError}
        </div>
      ) : null}
      {repo?.lastPrUrl ? (
        <p className="t-small">
          <a
            href={repo.lastPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="github-pr"
          >
            <ExternalLink size={12} /> {t('github.lastPr', { version: repo.lastVersion ?? '?' })}
          </a>
          {repo.lastSyncedAt ? (
            <span className="t-muted"> · {formatDateTime(repo.lastSyncedAt)}</span>
          ) : null}
        </p>
      ) : null}
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {field('repo', { placeholder: 'owner/repo', required: true })}
        {field('token', {
          type: 'password',
          autoComplete: 'off',
          placeholder: repo ? t('github.tokenKept') : 'github_pat_…',
          required: !repo,
        })}
        <div className="github-panel__row">
          {field('baseBranch', { placeholder: 'main' })}
          {field('directory', { placeholder: t('github.rootDir') })}
        </div>
        <label className="github-panel__check">
          <input
            type="checkbox"
            checked={form.autoOnApprove}
            disabled={!allowed}
            onChange={(e) => setForm((f) => ({ ...f, autoOnApprove: e.target.checked }))}
          />
          {t('github.auto')}
        </label>
        <div className="ai-tools__actions">
          <button
            type="submit"
            className="btn btn--sm btn--primary"
            disabled={!allowed || busy}
            data-testid="github-save"
          >
            {repo ? t('common.save') : t('github.connect')}
          </button>
          {repo ? (
            <>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!allowed || busy}
                onClick={() => void sync()}
                data-testid="github-sync"
              >
                <GitPullRequest />
                {t('github.syncNow')}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => void disconnect()}
              >
                {t('github.disconnect')}
              </button>
            </>
          ) : null}
        </div>
      </form>
    </div>
  )
}
