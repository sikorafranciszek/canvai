import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'

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
  return (
    <>
      <Head title="Załóż konto" />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">Załóż konto</h1>
          <p className="t-muted">
            Zbieraj materiały klienta na tablicy i generuj z nich specyfikację DESIGN.md.
          </p>
        </div>

        <Form route="new_account.store" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              <Field
                id="fullName"
                label="Imię i nazwisko"
                type="text"
                autoComplete="name"
                autoFocus
                placeholder="Anna Kowalska"
                error={errors.fullName}
              />
              <Field
                id="email"
                label="E-mail służbowy"
                type="email"
                autoComplete="email"
                placeholder="ty@firma.pl"
                error={errors.email}
              />
              <Field
                id="password"
                label="Hasło"
                type="password"
                autoComplete="new-password"
                hint="Od 8 do 32 znaków."
                error={errors.password}
              />
              <Field
                id="passwordConfirmation"
                label="Powtórz hasło"
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
                Utwórz konto
              </button>
            </>
          )}
        </Form>
      </div>
      <p className="auth__footer">
        Masz już konto?{' '}
        <Link route="session.create" className="link">
          Zaloguj się
        </Link>
      </p>
    </>
  )
}
