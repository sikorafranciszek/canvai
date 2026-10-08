import { Form, Link } from '@adonisjs/inertia/react'
import { Head, usePage } from '@inertiajs/react'
import { AlertCircle } from 'lucide-react'
import { translateFlash } from '~/lib/format'
import { useT } from '~/i18n'
import { privacyUrl } from '~/lib/consent'

type FormState = { errors: Record<string, string>; processing: boolean }

function Field({
  id,
  label,
  error,
  hint,
  ...input
}: {
  id: string
  label: string
  error?: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        className="input"
        id={id}
        name={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...input}
      />
      {error ? (
        <div className="field__error" id={`${id}-error`}>
          {error}
        </div>
      ) : hint ? (
        <div className="field__hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

export default function Signup() {
  const { t } = useT()
  const { flash } = usePage()
  // Np. limit zakładania kont z jednego adresu (SEC-4) — bez tego formularz „odbija” bez słowa.
  const flashError = typeof flash.error === 'string' ? translateFlash(flash.error) : null
  return (
    <>
      <Head title={t('auth.signup.title')} />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('auth.signup.title')}</h1>
          <p className="t-muted">{t('auth.signup.subtitle')}</p>
        </div>

        <Form route="new_account.store" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              {flashError ? (
                <div className="alert alert--danger" role="alert" data-testid="signup-error">
                  <AlertCircle />
                  {flashError}
                </div>
              ) : null}
              <Field
                id="fullName"
                label={t('auth.field.fullName')}
                type="text"
                autoComplete="name"
                autoFocus
                placeholder={t('auth.field.fullNamePlaceholder')}
                error={errors.fullName}
              />
              <Field
                id="email"
                label={t('auth.field.workEmail')}
                type="email"
                autoComplete="email"
                placeholder={t('auth.field.emailPlaceholder')}
                error={errors.email}
              />
              <Field
                id="password"
                label={t('auth.field.password')}
                type="password"
                autoComplete="new-password"
                hint={t('auth.field.passwordHint')}
                error={errors.password}
              />
              <Field
                id="passwordConfirmation"
                label={t('auth.field.passwordConfirmation')}
                type="password"
                autoComplete="new-password"
                error={errors.passwordConfirmation}
              />

              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={processing}
                data-testid="signup-submit"
              >
                {processing ? <span className="spinner" /> : null}
                {t('auth.signup.submit')}
              </button>
              <p className="t-small t-faint" style={{ textAlign: 'center' }}>
                {t('auth.signup.privacy')}{' '}
                <a className="link" href={privacyUrl()} target="_blank" rel="noopener">
                  {t('legal.privacyLower')}
                </a>
                .
              </p>
            </>
          )}
        </Form>
      </div>
      <p className="auth__footer">
        {t('auth.signup.hasAccount')}{' '}
        <Link route="session.create" className="link">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </>
  )
}
