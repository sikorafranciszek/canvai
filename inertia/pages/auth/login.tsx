import { Form, Link } from '@adonisjs/inertia/react'
import { Head, usePage } from '@inertiajs/react'
import { translateFlash } from '~/lib/format'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useT } from '~/i18n'

type FormState = { errors: Record<string, string>; processing: boolean }

export default function Login() {
  const { flash } = usePage()
  const { t } = useT()
  const flashError = typeof flash.error === 'string' ? translateFlash(flash.error) : null
  const flashSuccess = typeof flash.success === 'string' ? flash.success : null
  return (
    <>
      <Head title={t('auth.login.headTitle')} />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('auth.login.title')}</h1>
          <p className="t-muted">{t('auth.login.subtitle')}</p>
        </div>

        <Form route="session.store" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              {errors.E_INVALID_CREDENTIALS ? (
                <div className="alert alert--danger" role="alert" data-testid="login-error">
                  <AlertCircle />
                  {t('auth.login.invalid')}
                </div>
              ) : flashError ? (
                <div className="alert alert--danger" role="alert" data-testid="login-error">
                  <AlertCircle />
                  {flashError}
                </div>
              ) : flashSuccess ? (
                <div className="alert alert--notice" role="status" data-testid="flash-success">
                  <CheckCircle2 />
                  {flashSuccess}
                </div>
              ) : null}

              <div className="field">
                <label className="field__label" htmlFor="email">
                  {t('auth.field.email')}
                </label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  id="email"
                  autoComplete="username"
                  autoFocus
                  placeholder={t('auth.field.emailPlaceholder')}
                  aria-invalid={errors.email ? 'true' : undefined}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email ? (
                  <div className="field__error" id="email-error">
                    {errors.email}
                  </div>
                ) : null}
              </div>

              <div className="field">
                <div className="field__row">
                  <label className="field__label" htmlFor="password">
                    {t('auth.field.password')}
                  </label>
                  <Link route="password.forgot" className="link t-small" data-testid="forgot-link">
                    {t('auth.login.forgot')}
                  </Link>
                </div>
                <input
                  className="input"
                  type="password"
                  name="password"
                  id="password"
                  autoComplete="current-password"
                  aria-invalid={errors.password ? 'true' : undefined}
                />
                {errors.password ? <div className="field__error">{errors.password}</div> : null}
              </div>

              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={processing}
                data-testid="login-submit"
              >
                {processing ? <span className="spinner" /> : null}
                {t('auth.login.submit')}
              </button>
            </>
          )}
        </Form>
      </div>
      <p className="auth__footer">
        {t('auth.login.noAccount')}{' '}
        <Link route="new_account.create" className="link">
          {t('auth.login.signupLink')}
        </Link>
      </p>
    </>
  )
}
