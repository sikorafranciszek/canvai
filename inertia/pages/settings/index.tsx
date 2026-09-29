import { Form } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { BadgeCheck } from 'lucide-react'
import type React from 'react'
import { LanguageSwitcher } from '~/components/ui/LanguageSwitcher'
import { formatDateTime } from '~/lib/format'
import { useT } from '~/i18n'

interface Account {
  fullName: string | null
  email: string
  emailVerifiedAt: string | null
  createdAt: string | null
}

type FormState = { errors: Record<string, string>; processing: boolean }

function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string
  description: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section className="card settings-section" data-testid={testId}>
      <div className="settings-section__head">
        <h2 className="t-body-lg" style={{ fontWeight: 500 }}>
          {title}
        </h2>
        <p className="t-muted t-small">{description}</p>
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  )
}

function PasswordField({
  id,
  label,
  error,
  hint,
  autoComplete,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  autoComplete: string
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        className="input"
        type="password"
        id={id}
        name={id}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : undefined}
      />
      {error ? (
        <div className="field__error">{error}</div>
      ) : hint ? (
        <div className="field__hint">{hint}</div>
      ) : null}
    </div>
  )
}

export default function Settings({ account }: { account: Account }) {
  const { t } = useT()
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Head title={t('settings.headTitle')} />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">{t('settings.title')}</h1>
          <p className="t-muted">{t('settings.subtitle')}</p>
        </div>
      </header>

      <Section
        title={t('settings.profile.title')}
        description={t('settings.profile.desc')}
        testId="settings-profile"
      >
        <Form route="settings.profile" method="patch" options={{ preserveScroll: true }}>
          {({ errors, processing }: FormState) => (
            <div className="settings-form">
              <div className="field">
                <label className="field__label" htmlFor="fullName">
                  {t('auth.field.fullName')}
                </label>
                <input
                  className="input"
                  id="fullName"
                  name="fullName"
                  defaultValue={account.fullName ?? ''}
                  autoComplete="name"
                  maxLength={120}
                  aria-invalid={errors.fullName ? 'true' : undefined}
                />
                {errors.fullName ? <div className="field__error">{errors.fullName}</div> : null}
              </div>
              <div className="field">
                <span className="field__label">{t('settings.email')}</span>
                <div className="settings-readonly">
                  <span className="t-truncate">{account.email}</span>
                  {account.emailVerifiedAt ? (
                    <span className="badge badge--accent">
                      <BadgeCheck />
                      {t('settings.emailVerified')}
                    </span>
                  ) : null}
                </div>
                {account.createdAt ? (
                  <div className="field__hint">
                    {t('settings.memberSince', { date: formatDateTime(account.createdAt) })}
                  </div>
                ) : null}
              </div>
              <div className="settings-actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={processing}
                  data-testid="profile-submit"
                >
                  {t('settings.profile.save')}
                </button>
              </div>
            </div>
          )}
        </Form>
      </Section>

      <Section
        title={t('settings.password.title')}
        description={t('settings.password.desc')}
        testId="settings-password"
      >
        <Form
          route="settings.password"
          method="put"
          resetOnSuccess
          options={{ preserveScroll: true }}
        >
          {({ errors, processing }: FormState) => (
            <div className="settings-form">
              <PasswordField
                id="currentPassword"
                label={t('auth.field.currentPassword')}
                error={errors.currentPassword}
                hint={t('settings.password.forgot')}
                autoComplete="current-password"
              />
              <PasswordField
                id="password"
                label={t('auth.field.newPassword')}
                error={errors.password}
                hint={t('auth.field.passwordHint')}
                autoComplete="new-password"
              />
              <PasswordField
                id="passwordConfirmation"
                label={t('auth.field.newPasswordConfirmation')}
                error={errors.passwordConfirmation}
                autoComplete="new-password"
              />
              <div className="settings-actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={processing}
                  data-testid="password-submit"
                >
                  {t('settings.password.submit')}
                </button>
              </div>
            </div>
          )}
        </Form>
      </Section>

      <Section title={t('settings.language.title')} description={t('settings.language.desc')}>
        <LanguageSwitcher />
      </Section>
    </div>
  )
}
