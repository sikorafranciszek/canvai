import { Head } from '@inertiajs/react'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'
import { useT } from '~/i18n'

export default function NotFound() {
  const { t } = useT()
  return (
    <div className="error-page">
      <Head title={t('error.404.headTitle')} />
      <div className="error-page__inner">
        <Brand />
        <div className="error-page__code">404</div>
        <h1 className="t-title">{t('error.404.title')}</h1>
        <p className="t-muted">{t('error.404.body')}</p>
        <a href="/boards" className="btn btn--primary" style={{ marginTop: 8 }}>
          <ArrowLeft />
          {t('error.404.back')}
        </a>
      </div>
    </div>
  )
}
