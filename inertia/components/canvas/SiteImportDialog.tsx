/** Import strony z adresu URL: karta linku, obraz podglądu i notatka ze stylem (kolory, fonty). */
import { useState } from 'react'
import { Globe } from 'lucide-react'
import { Dialog } from '~/components/ui/Dialog'
import { useBoardStore } from '~/lib/board/session'
import { useT } from '~/i18n'

export function SiteImportButton() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const importSite = useBoardStore((s) => s.importSite)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    const ok = await importSite(url.trim())
    setBusy(false)
    if (ok) {
      setOpen(false)
      setUrl('')
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--quiet btn--sm"
        data-testid="site-import-button"
        onClick={() => setOpen(true)}
        data-tip={t('siteImport.hint')}
      >
        <Globe />
        {t('siteImport.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('siteImport.title')}
        description={t('siteImport.desc')}
        testId="site-import-dialog"
      >
        <form onSubmit={submit} className="settings-form">
          <div className="field">
            <label className="field__label" htmlFor="site-import-url">
              {t('siteImport.url')}
            </label>
            <input
              id="site-import-url"
              className="input"
              type="url"
              required
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="site-import-url"
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-testid="site-import-submit"
            >
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Globe />}
              {busy ? t('siteImport.working') : t('siteImport.submit')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
