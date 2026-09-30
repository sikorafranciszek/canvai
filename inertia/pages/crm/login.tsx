import { Form } from '@adonisjs/inertia/react'
import { Head, usePage } from '@inertiajs/react'
import { ShieldCheck } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'
import { CRM_FLASH } from '~/components/crm/CrmLayout'

export default function CrmLogin() {
  const { flash } = usePage()
  const error = flash?.error ? (CRM_FLASH[flash.error as string] ?? String(flash.error)) : null
  return (
    <div className="auth">
      <Head title="CRM — logowanie" />
      <div className="auth__inner">
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
          <Brand />
          <span className="badge badge--accent">CRM</span>
        </div>
        <div className="card auth__card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="t-title">Panel administracyjny</h1>
            <p className="t-muted t-small">Dostęp tylko dla administratorów canvai.</p>
          </div>
          {error ? (
            <div className="alert alert--danger" role="alert" data-testid="crm-login-error">
              {error}
            </div>
          ) : null}
          <Form route="crm.login.store" method="post">
            {({ processing }: { processing: boolean }) => (
              <div className="settings-form">
                <div className="field">
                  <label className="field__label" htmlFor="crm-email">
                    E-mail
                  </label>
                  <input
                    className="input"
                    id="crm-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="crm-password">
                    Hasło
                  </label>
                  <input
                    className="input"
                    id="crm-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn--primary btn--lg btn--block"
                  disabled={processing}
                  data-testid="crm-login-submit"
                >
                  <ShieldCheck />
                  Zaloguj się
                </button>
              </div>
            )}
          </Form>
        </div>
      </div>
    </div>
  )
}
