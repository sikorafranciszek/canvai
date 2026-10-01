import { Head } from '@inertiajs/react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'
import { useT } from '~/i18n'

/** Potwierdzenie wypisu z maili cyklicznych (link z maila, bez logowania). */
export default function Unsubscribed({ ok }: { ok: boolean }) {
  const { t } = useT()
  return (
    <div className="auth">
      <Head title={t('unsubscribe.title')} />
      <div className="auth__inner">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Brand />
        </div>
        <div
          className="card"
          style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="empty-state__icon">{ok ? <CheckCircle2 /> : <AlertCircle />}</div>
          <h1 className="t-title">{ok ? t('unsubscribe.title') : t('unsubscribe.invalid')}</h1>
          <p className="t-muted">{ok ? t('unsubscribe.body') : t('unsubscribe.invalidBody')}</p>
          <a className="btn" href="/settings#notifications" style={{ alignSelf: 'flex-start' }}>
            {t('unsubscribe.settings')}
          </a>
        </div>
      </div>
    </div>
  )
}
