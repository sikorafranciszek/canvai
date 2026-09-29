import { Form, Link } from '@adonisjs/inertia/react'
import { Head, usePage } from '@inertiajs/react'
import { translateFlash } from '~/lib/format'
import { AlertCircle } from 'lucide-react'

type FormState = { errors: Record<string, string>; processing: boolean }

export default function Login() {
  const { flash } = usePage()
  const flashError = typeof flash.error === 'string' ? translateFlash(flash.error) : null
  return (
    <>
      <Head title="Logowanie" />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">Zaloguj się</h1>
          <p className="t-muted">Wróć do swoich tablic i dokumentów DESIGN.md.</p>
        </div>

        <Form route="session.store" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              {errors.E_INVALID_CREDENTIALS || flashError ? (
                <div className="alert alert--danger" role="alert" data-testid="login-error">
                  <AlertCircle />
                  {flashError ?? 'Nieprawidłowy e-mail lub hasło'}
                </div>
              ) : null}

              <div className="field">
                <label className="field__label" htmlFor="email">
                  E-mail
                </label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  id="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="ty@firma.pl"
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
                <label className="field__label" htmlFor="password">
                  Hasło
                </label>
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
                Zaloguj się
              </button>
            </>
          )}
        </Form>
      </div>
      <p className="auth__footer">
        Nie masz konta?{' '}
        <Link route="new_account.create" className="link">
          Załóż konto
        </Link>
      </p>
    </>
  )
}
