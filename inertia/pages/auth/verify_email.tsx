import { Form } from '@adonisjs/inertia/react'
import { Head, Link } from '@inertiajs/react'
import { MailCheck } from 'lucide-react'
import { FlashAlert } from '~/components/ui/FlashAlert'
import { useT } from '~/i18n'

export default function VerifyEmail({
  email,
  sampleBoardId,
}: {
  email: string
  sampleBoardId?: number | null
}) {
  const { t } = useT()
  return (
    <>
      <Head title={t('auth.verify.headTitle')} />
      <div className="card auth__card" data-testid="verify-email">
        <div className="empty-state__icon">
          <MailCheck />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('auth.verify.title')}</h1>
          <p className="t-muted">{t('auth.verify.body', { email })}</p>
          <p className="t-muted t-small">{t('auth.verify.spam')}</p>
        </div>
        <FlashAlert />
        <Form route="verification.resend">
          {({ processing }: { processing: boolean }) => (
            <button
              type="submit"
              className="btn btn--primary btn--lg btn--block"
              disabled={processing}
              data-testid="verify-resend"
            >
              {processing ? <span className="spinner" /> : null}
              {t('auth.verify.resend')}
            </button>
          )}
        </Form>
        {sampleBoardId ? (
          <Link
            href={`/boards/${sampleBoardId}`}
            className="btn btn--lg btn--block"
            data-testid="verify-sample"
          >
            {t('auth.verify.sample')}
          </Link>
        ) : null}
      </div>
      <Form route="session.destroy" style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="submit" className="btn btn--quiet btn--sm">
          {t('auth.verify.otherAccount')}
        </button>
      </Form>
    </>
  )
}
