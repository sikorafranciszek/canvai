import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { BadgeCheck, Copy, KeyRound, Lock, Trash2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { figmaStatus, setFigmaToken } from '~/lib/board/api'
import { toast } from 'sonner'
import { relativeTime } from '~/lib/format'
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

interface ApiSettings {
  enabled: boolean
  endpoint: string
  restBase: string
  newToken: string | null
  tokens: {
    id: number
    name: string
    prefix: string
    createdAt: string | null
    lastUsedAt: string | null
  }[]
}

function CopyField({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const { t } = useT()
  return (
    <div className="copy-field">
      <input
        className="input"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        data-testid={testId}
      />
      <button
        type="button"
        className="btn btn--icon"
        aria-label={t('common.copy')}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            toast.success(t('settings.api.copied'))
          } catch {
            toast.error(t('doc.copyFailed'))
          }
        }}
      >
        <Copy />
      </button>
    </div>
  )
}

function ApiSection({ api }: { api: ApiSettings }) {
  const { t } = useT()
  const [client, setClient] = useState<'claude' | 'cursor' | 'rest'>('claude')
  const token = api.newToken ?? 'cvai_…'
  const snippets = {
    claude: `claude mcp add --transport http canvai ${api.endpoint} --header "Authorization: Bearer ${token}"`,
    cursor: JSON.stringify(
      {
        mcpServers: {
          canvai: { url: api.endpoint, headers: { Authorization: `Bearer ${token}` } },
        },
      },
      null,
      2
    ),
    rest: `curl -H "Authorization: Bearer ${token}" ${api.restBase}/boards\ncurl -H "Authorization: Bearer ${token}" ${api.restBase}/boards/<id>/design-md`,
  }

  return (
    <Section
      title={t('settings.api.title')}
      description={t('settings.api.desc')}
      testId="settings-api"
    >
      <div id="api" className="settings-form">
        {!api.enabled ? (
          <div className="alert alert--notice" data-testid="api-locked">
            <Lock />
            <span style={{ flex: 1 }}>{t('settings.api.locked')}</span>
            <Link route="billing.show" className="btn btn--sm btn--primary">
              {t('billing.upgrade')}
            </Link>
          </div>
        ) : null}

        {api.newToken ? (
          <div className="api-new-token" data-testid="api-new-token" data-clarity-mask="true">
            <strong>{t('settings.api.newToken')}</strong>
            <CopyField
              value={api.newToken}
              label={t('settings.api.newToken')}
              testId="api-new-token-value"
            />
            <span className="t-small t-muted">{t('settings.api.newTokenHint')}</span>
          </div>
        ) : null}

        <div className="field">
          <span className="field__label">{t('settings.api.connect')}</span>
          <div className="segmented segmented--text" role="tablist">
            {(['claude', 'cursor', 'rest'] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-pressed={client === c}
                onClick={() => setClient(c)}
              >
                {t(`settings.api.client.${c}`)}
              </button>
            ))}
          </div>
          <pre className="code-snippet" data-testid="api-snippet">
            {snippets[client]}
          </pre>
          <div className="field__hint">{t(`settings.api.clientHint.${client}`)}</div>
        </div>

        {api.enabled ? (
          <Form
            route="apiTokens.store"
            method="post"
            resetOnSuccess
            options={{ preserveScroll: true }}
          >
            {({ errors, processing }: FormState) => (
              <div className="api-create">
                <div className="field" style={{ flex: 1 }}>
                  <label className="field__label" htmlFor="api-token-name">
                    {t('settings.api.tokenName')}
                  </label>
                  <input
                    className="input"
                    id="api-token-name"
                    name="name"
                    placeholder={t('settings.api.tokenPlaceholder')}
                    maxLength={80}
                    aria-invalid={errors.name ? 'true' : undefined}
                  />
                  {errors.name ? <div className="field__error">{errors.name}</div> : null}
                </div>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={processing}
                  data-testid="api-create"
                >
                  <KeyRound />
                  {t('settings.api.create')}
                </button>
              </div>
            )}
          </Form>
        ) : null}

        {api.tokens.length ? (
          <ul className="token-list" data-testid="api-token-list">
            {api.tokens.map((tk) => (
              <li key={tk.id}>
                <KeyRound size={15} />
                <div className="token-list__text">
                  <span>{tk.name}</span>
                  <span className="t-small t-faint">
                    <code>{tk.prefix}…</code> ·{' '}
                    {tk.lastUsedAt
                      ? t('settings.api.lastUsed', { when: relativeTime(tk.lastUsedAt) })
                      : t('settings.api.neverUsed')}
                  </span>
                </div>
                <Form
                  route="apiTokens.destroy"
                  routeParams={{ id: tk.id }}
                  method="delete"
                  options={{ preserveScroll: true }}
                >
                  <button
                    type="submit"
                    className="btn btn--quiet btn--sm"
                    aria-label={t('settings.api.revoke')}
                  >
                    <Trash2 />
                    {t('settings.api.revoke')}
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}

function FigmaSection() {
  const { t } = useT()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void figmaStatus().then((s) => setConnected(s.connected))
  }, [])

  const update = async (value: string | null) => {
    setBusy(true)
    try {
      const s = await setFigmaToken(value)
      setConnected(s.connected)
      setToken('')
      toast.success(t(value ? 'settings.figma.saved' : 'settings.figma.removed'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('figma.failedShort'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title={t('settings.figma.title')}
      description={t('settings.figma.desc')}
      testId="settings-figma"
    >
      <div className="settings-form">
        <p className="t-small">
          {connected ? (
            <span className="level level--good">{t('settings.figma.connected')}</span>
          ) : connected === false ? (
            <span className="level level--neutral">{t('settings.figma.notConnected')}</span>
          ) : null}
        </p>
        <form
          className="api-create"
          onSubmit={(e) => {
            e.preventDefault()
            if (token.trim()) void update(token.trim())
          }}
        >
          <div className="field" style={{ flex: 1 }}>
            <label className="field__label" htmlFor="figma-settings-token">
              {t('figma.token')}
            </label>
            <input
              id="figma-settings-token"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="figd_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || token.trim().length < 20}
          >
            {t('settings.figma.save')}
          </button>
          {connected ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void update(null)}>
              {t('settings.figma.remove')}
            </button>
          ) : null}
        </form>
        <span className="field__hint">{t('figma.tokenHint')}</span>
      </div>
    </Section>
  )
}

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

export default function Settings({ account, api }: { account: Account; api: ApiSettings }) {
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

      <ApiSection api={api} />

      <FigmaSection />

      <Section title={t('settings.language.title')} description={t('settings.language.desc')}>
        <LanguageSwitcher />
      </Section>
    </div>
  )
}
