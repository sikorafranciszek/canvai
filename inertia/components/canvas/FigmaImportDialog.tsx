/** Import z Figmy: link do pliku/ramki + osobisty token (zapamiętywany zaszyfrowany). */
import { useEffect, useState } from 'react'
import { Frame } from 'lucide-react'
import { Dialog } from '~/components/ui/Dialog'
import { useBoardStore } from '~/lib/board/session'
import { FigmaImportError, figmaStatus } from '~/lib/board/api'
import { useT } from '~/i18n'

export function FigmaImportButton() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [needToken, setNeedToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const importFigma = useBoardStore((s) => s.importFigma)

  useEffect(() => {
    if (!open) return
    void figmaStatus().then((s) => setConnected(s.connected))
  }, [open])

  const showToken = connected === false || needToken

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await importFigma({
        url: url.trim(),
        ...(token.trim() ? { token: token.trim(), remember } : {}),
      })
      setOpen(false)
      setUrl('')
      setToken('')
    } catch (err) {
      const code = err instanceof FigmaImportError ? err.code : null
      if (code === 'E_FIGMA_TOKEN' || code === 'E_FIGMA_AUTH') setNeedToken(true)
      setError(err instanceof Error ? err.message : t('figma.failedShort'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--quiet btn--sm"
        data-testid="figma-import-button"
        onClick={() => setOpen(true)}
        data-tip={t('figma.hint')}
      >
        <Frame />
        Figma
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('figma.title')}
        description={t('figma.desc')}
        testId="figma-import-dialog"
      >
        <form onSubmit={submit} className="settings-form">
          <div className="field">
            <label className="field__label" htmlFor="figma-url">
              {t('figma.url')}
            </label>
            <input
              id="figma-url"
              className="input"
              type="url"
              required
              placeholder="https://www.figma.com/design/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="figma-url"
              autoFocus
            />
            <span className="field__hint">{t('figma.urlHint')}</span>
          </div>
          {showToken ? (
            <div className="field">
              <label className="field__label" htmlFor="figma-token">
                {t('figma.token')}
              </label>
              <input
                id="figma-token"
                className="input"
                type="password"
                autoComplete="off"
                placeholder="figd_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                data-testid="figma-token"
              />
              <span className="field__hint">
                {t('figma.tokenHint')}{' '}
                <a
                  href="https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('figma.tokenHelp')}
                </a>
              </span>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t('figma.remember')}
              </label>
            </div>
          ) : connected ? (
            <p className="t-small t-muted">{t('figma.connected')}</p>
          ) : null}
          {error ? (
            <div className="alert alert--danger" role="alert">
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || (showToken && !token.trim())}
              data-testid="figma-import-submit"
            >
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Frame />}
              {busy ? t('figma.working') : t('figma.submit')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
