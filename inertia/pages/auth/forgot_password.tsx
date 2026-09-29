import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { ArrowLeft } from 'lucide-react'
import { FlashAlert } from '~/components/ui/FlashAlert'
import { useT } from '~/i18n'

type FormState = { errors: Record<string, string>; processing: boolean }

export default function ForgotPassword() {
  const { t } = useT()
  return (
    <>
      <Head title={t('auth.forgot.headTitle')} />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('auth.forgot.title')}</h1>
          <p className="t-muted">{t('auth.forgot.subtitle')}</p>
        </div>
        <Form route="password.email" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              <FlashAlert />
              <div className="field">
                <label className="field__label" htmlFor="email">
                  {t('auth.field.email')}
                </label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  id="email"
                  autoComplete="email"
                  autoFocus
                  placeholder={t('auth.field.emailPlaceholder')}
                  aria-invalid={errors.email ? 'true' : undefined}
                />
                {errors.email ? <div className="field__error">{errors.email}</div> : null}
              </div>
              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={processing}
                data-testid="forgot-submit"
              >
                {processing ? <span className="spinner" /> : null}
                {t('auth.forgot.submit')}
              </button>
            </>
          )}
        </Form>
      </div>
      <p className="auth__footer">
        <Link
          route="session.create"
          className="link"
          style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
        >
          <ArrowLeft size={14} />
          {t('auth.forgot.back')}
        </Link>
      </p>
    </>
  )
}
