import { SpecChanges } from '~/components/design/SpecChanges'
import type { SpecChangesDto } from '~/lib/board/api'
import { Form } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { CheckCircle2, FileUp, MessageSquareWarning, Send, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Brand } from '~/components/ui/Brand'
import { LanguageSwitcher } from '~/components/ui/LanguageSwitcher'
import { MarkdownView } from '~/components/design/MarkdownView'
import { LegalLinks } from '~/components/ui/ConsentBanner'
import { formatDateTime } from '~/lib/format'
import { useT } from '~/i18n'

interface PortalProps {
  token: string
  board: { title: string }
  owner: { name: string }
  brand?: { name: string; logoUrl: string | null; accent: string | null; whiteLabel: boolean }
  allowUpload: boolean
  maxFiles: number
  submitted: number
  doc: {
    version: number
    contentMd: string | null
    generatedAt: string | null
    changes?: (SpecChangesDto & { from: number }) | null
  } | null
  decision: { decision: 'approved' | 'changes'; name: string; createdAt: string | null } | null
}

type FormState = { errors: Record<string, string>; processing: boolean; wasSuccessful?: boolean }

const NAME_KEY = 'canvai.portal.name'

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(value: string) {
  try {
    localStorage.setItem(NAME_KEY, value)
  } catch {
    // Prywatne okno — imię trzeba wpisać ponownie, nic więcej.
  }
}

export default function Portal({ portal }: { portal: PortalProps }) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const decisionInput = useRef<HTMLInputElement>(null)

  useEffect(() => setName(readName()), [])

  return (
    <div
      className="portal"
      style={
        portal.brand?.whiteLabel && portal.brand.accent
          ? ({
              '--color-deep-teal': portal.brand.accent,
              '--color-ink': portal.brand.accent,
            } as React.CSSProperties)
          : undefined
      }
    >
      <Head title={`${portal.board.title} — ${t('portal.title')}`} />
      <header className="portal__top">
        {portal.brand?.whiteLabel ? (
          <span className="portal__brand">
            {portal.brand.logoUrl ? (
              <img src={portal.brand.logoUrl} alt={portal.brand.name} className="portal__logo" />
            ) : (
              <b>{portal.brand.name}</b>
            )}
          </span>
        ) : (
          <a href="https://canvai.dev" target="_blank" rel="noopener noreferrer">
            <Brand />
          </a>
        )}
        <span className="badge badge--outline">{t('portal.title')}</span>
        <div style={{ marginLeft: 'auto' }}>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="portal__main" data-clarity-mask="true">
        <section className="portal__hero">
          <h1 className="t-display">{portal.board.title}</h1>
          <p className="t-muted">{t('portal.intro', { owner: portal.owner.name })}</p>
        </section>

        <div className="portal__grid">
          {portal.allowUpload ? (
            <section className="card portal__card" data-testid="portal-upload">
              <h2 className="portal__card-title">
                <FileUp size={18} />
                {t('portal.upload.title')}
              </h2>
              <p className="t-small t-muted">{t('portal.upload.desc')}</p>
              <Form
                route="portal.materials"
                routeParams={{ token: portal.token }}
                method="post"
                resetOnSuccess
                options={{ preserveScroll: true }}
                onSuccess={() => {
                  setFiles([])
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                {({ errors, processing }: FormState) => (
                  <div className="settings-form">
                    <div className="field">
                      <label className="field__label" htmlFor="portal-name">
                        {t('portal.field.name')}
                      </label>
                      <input
                        className="input"
                        id="portal-name"
                        name="name"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          rememberName(e.target.value)
                        }}
                        aria-invalid={errors.name ? 'true' : undefined}
                      />
                      {errors.name ? <div className="field__error">{errors.name}</div> : null}
                    </div>

                    <label className="dropzone" data-testid="portal-dropzone">
                      <input
                        ref={fileInput}
                        type="file"
                        name="files[]"
                        multiple
                        accept="image/*,application/pdf"
                        onChange={(e) =>
                          setFiles(Array.from(e.target.files ?? []).slice(0, portal.maxFiles))
                        }
                        data-testid="portal-files"
                      />
                      <FileUp />
                      <span>
                        {files.length
                          ? t('portal.upload.chosen', { n: files.length })
                          : t('portal.upload.drop', { max: portal.maxFiles })}
                      </span>
                      {files.length ? (
                        <span className="t-small t-faint t-truncate" style={{ maxWidth: '100%' }}>
                          {files.map((f) => f.name).join(', ')}
                        </span>
                      ) : null}
                    </label>

                    <div className="field">
                      <label className="field__label" htmlFor="portal-url">
                        {t('portal.field.url')}
                      </label>
                      <input
                        className="input"
                        id="portal-url"
                        name="url"
                        type="url"
                        placeholder="https://"
                      />
                      {errors.url ? <div className="field__error">{errors.url}</div> : null}
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor="portal-note">
                        {t('portal.field.note')}
                      </label>
                      <textarea
                        className="input textarea"
                        id="portal-note"
                        name="note"
                        rows={3}
                        maxLength={2000}
                        placeholder={t('portal.field.notePlaceholder')}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={processing}
                      data-testid="portal-send"
                    >
                      {processing ? (
                        <span className="spinner" style={{ width: 12, height: 12 }} />
                      ) : (
                        <Send />
                      )}
                      {t('portal.upload.submit')}
                    </button>
                    {portal.submitted > 0 ? (
                      <span className="t-small t-faint">
                        {t('portal.upload.count', { n: portal.submitted })}
                      </span>
                    ) : null}
                  </div>
                )}
              </Form>
            </section>
          ) : null}

          {portal.doc?.contentMd ? (
            <section className="card portal__card portal__doc" data-testid="portal-doc">
              <h2 className="portal__card-title">
                {t('portal.doc.title', { version: portal.doc.version })}
              </h2>
              <p className="t-small t-muted">
                {t('portal.doc.desc')}
                {portal.doc.generatedAt ? ` · ${formatDateTime(portal.doc.generatedAt)}` : ''}
              </p>
              <div>
                <a
                  className="btn btn--sm"
                  href={`/c/${portal.token}/print?autoprint=1`}
                  target="_blank"
                  rel="noopener"
                  data-testid="portal-pdf"
                >
                  {t('print.button')}
                </a>
              </div>
              {portal.decision ? (
                <div
                  className={`alert ${portal.decision.decision === 'approved' ? 'alert--notice' : 'alert--danger'}`}
                  data-testid="portal-decision"
                >
                  {portal.decision.decision === 'approved' ? (
                    <CheckCircle2 />
                  ) : (
                    <MessageSquareWarning />
                  )}
                  {t(
                    portal.decision.decision === 'approved'
                      ? 'portal.doc.approvedBy'
                      : 'portal.doc.changesBy',
                    {
                      name: portal.decision.name,
                    }
                  )}
                </div>
              ) : null}
              {portal.doc.changes ? (
                <SpecChanges
                  changes={portal.doc.changes}
                  from={portal.doc.changes.from}
                  to={portal.doc.version}
                  audience="client"
                />
              ) : null}
              <div className="portal__md">
                <MarkdownView source={portal.doc.contentMd} />
              </div>
              <Form
                route="portal.feedback"
                routeParams={{ token: portal.token }}
                method="post"
                resetOnSuccess
                options={{ preserveScroll: true }}
              >
                {({ errors, processing }: FormState) => (
                  <div className="settings-form">
                    <input type="hidden" name="version" value={portal.doc!.version} />
                    <input
                      type="hidden"
                      name="decision"
                      ref={decisionInput}
                      defaultValue="approved"
                    />
                    <input type="hidden" name="name" value={name} />
                    {!name ? (
                      <div className="field">
                        <label className="field__label" htmlFor="portal-name-2">
                          {t('portal.field.name')}
                        </label>
                        <input
                          className="input"
                          id="portal-name-2"
                          required
                          maxLength={120}
                          value={name}
                          onChange={(e) => {
                            setName(e.target.value)
                            rememberName(e.target.value)
                          }}
                        />
                      </div>
                    ) : null}
                    {errors.name ? <div className="field__error">{errors.name}</div> : null}
                    <div className="field">
                      <label className="field__label" htmlFor="portal-comment">
                        {t('portal.field.comment')}
                      </label>
                      <textarea
                        className="input textarea"
                        id="portal-comment"
                        name="comment"
                        rows={3}
                        maxLength={4000}
                        placeholder={t('portal.field.commentPlaceholder')}
                      />
                    </div>
                    <div className="portal__decide">
                      <button
                        type="submit"
                        className="btn"
                        disabled={processing}
                        onClick={() => {
                          if (decisionInput.current) decisionInput.current.value = 'changes'
                        }}
                        data-testid="portal-changes"
                      >
                        <MessageSquareWarning />
                        {t('portal.doc.requestChanges')}
                      </button>
                      <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={processing}
                        onClick={() => {
                          if (decisionInput.current) decisionInput.current.value = 'approved'
                        }}
                        data-testid="portal-approve"
                      >
                        <ThumbsUp />
                        {t('portal.doc.approve')}
                      </button>
                    </div>
                  </div>
                )}
              </Form>
            </section>
          ) : null}
        </div>
      </main>

      <footer className="portal__footer">
        {portal.brand?.whiteLabel ? (
          <span className="t-small t-muted">{portal.brand.name}</span>
        ) : (
          <a href="https://canvai.dev" target="_blank" rel="noopener noreferrer">
            {t('portal.poweredBy')}
          </a>
        )}
        <LegalLinks />
      </footer>
    </div>
  )
}
