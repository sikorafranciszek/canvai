import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { KeyRound } from 'lucide-react'
import { FlashAlert } from '~/components/ui/FlashAlert'
import { useT } from '~/i18n'

type FormState = { errors: Record<string, string>; processing: boolean }

export default function ResetPassword({ token, valid }: { token: string; valid: boolean }) {
  const { t } = useT()

  if (!valid) {
    return (
      <>
        <Head title={t('auth.reset.headTitle')} />
        <div className="card auth__card" data-testid="reset-invalid">
          <div className="empty-state__icon">
            <KeyRound />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="t-title">{t('auth.reset.invalidTitle')}</h1>
            <p className="t-muted">{t('auth.reset.invalidBody')}</p>
          </div>
          <Link route="password.forgot" className="btn btn--primary btn--lg btn--block">
            {t('auth.reset.requestNew')}
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <Head title={t('auth.reset.headTitle')} />
      <div className="card auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('auth.reset.title')}</h1>
          <p className="t-muted">{t('auth.reset.subtitle')}</p>
        </div>
        <Form route="password.update" className="auth__form">
          {({ errors, processing }: FormState) => (
            <>
              <FlashAlert />
              <input type="hidden" name="token" value={token} />
              <div className="field">
                <label className="field__label" htmlFor="password">
                  {t('auth.field.newPassword')}
                </label>
                <input
                  className="input"
                  type="password"
                  name="password"
                  id="password"
                  autoComplete="new-password"
                  autoFocus
                  aria-invalid={errors.password ? 'true' : undefined}
                />
                {errors.password ? (
                  <div className="field__error">{errors.password}</div>
                ) : (
                  <div className="field__hint">{t('auth.field.passwordHint')}</div>
                )}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="passwordConfirmation">
                  {t('auth.field.newPasswordConfirmation')}
                </label>
                <input
                  className="input"
                  type="password"
                  name="passwordConfirmation"
                  id="passwordConfirmation"
                  autoComplete="new-password"
                  aria-invalid={errors.passwordConfirmation ? 'true' : undefined}
                />
                {errors.passwordConfirmation ? (
                  <div className="field__error">{errors.passwordConfirmation}</div>
                ) : null}
              </div>
              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={processing}
                data-testid="reset-submit"
              >
                {processing ? <span className="spinner" /> : null}
                {t('auth.reset.submit')}
              </button>
            </>
          )}
        </Form>
      </div>
    </>
  )
}
