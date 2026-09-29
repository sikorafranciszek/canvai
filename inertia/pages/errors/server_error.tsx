import { Head } from '@inertiajs/react'
import { RotateCw } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'
import { useT } from '~/i18n'

export default function ServerError() {
  const { t } = useT()
  return (
    <div className="error-page">
      <Head title={t('error.500.headTitle')} />
      <div className="error-page__inner">
        <Brand />
        <div className="error-page__code">500</div>
        <h1 className="t-title">{t('error.500.title')}</h1>
        <p className="t-muted">{t('error.500.body')}</p>
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 8 }}
          onClick={() => window.location.reload()}
        >
          <RotateCw />
          {t('error.500.reload')}
        </button>
      </div>
    </div>
  )
}
