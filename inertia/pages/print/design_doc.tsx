/**
 * DESIGN.md do druku i zapisu jako PDF: okładka (tytuł, wersja, autor),
 * spis sekcji i treść. Pasek akcji nie trafia na wydruk (`@media print`).
 */
import { useEffect, useMemo } from 'react'
import { Head } from '@inertiajs/react'
import { ArrowLeft, Printer } from 'lucide-react'
import { MarkdownView, sectionTitles } from '~/components/design/MarkdownView'
import { formatDateTime } from '~/lib/format'
import { useT } from '~/i18n'

interface Props {
  doc: { title: string; version: number; contentMd: string; generatedAt: string | null }
  preparedBy: { name: string; logoUrl: string | null; accent: string | null; whiteLabel: boolean }
  backHref: string
}

/** Treść bez nagłówka H1 i stopki (są na okładce). */
function body(markdown: string) {
  return markdown.replace(/^# .*\n+/, '')
}

export default function PrintDesignDoc({ doc, preparedBy, backHref }: Props) {
  const { t } = useT()
  const sections = useMemo(() => sectionTitles(doc.contentMd), [doc.contentMd])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('autoprint') !== '1') return
    // Czekamy na fonty, żeby PDF nie złapał zastępczych.
    void document.fonts.ready.then(() => setTimeout(() => window.print(), 300))
  }, [])

  return (
    <div
      className="print-doc"
      style={preparedBy.accent ? ({ '--print-accent': preparedBy.accent } as any) : undefined}
    >
      <Head title={`${doc.title} — DESIGN.md v${doc.version}`} />
      <div className="print-doc__toolbar">
        <a className="btn btn--quiet btn--sm" href={backHref}>
          <ArrowLeft />
          {t('print.back')}
        </a>
        <span className="t-small t-muted">{t('print.hint')}</span>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => window.print()}
          data-testid="print-button"
        >
          <Printer />
          {t('print.button')}
        </button>
      </div>

      <article className="print-doc__page">
        <header className="print-doc__cover">
          {preparedBy.logoUrl ? (
            <img className="print-doc__logo" src={preparedBy.logoUrl} alt={preparedBy.name} />
          ) : null}
          <p className="print-doc__kicker">Design System · Style Reference</p>
          <h1 className="print-doc__title">{doc.title}</h1>
          <dl className="print-doc__meta">
            <div>
              <dt>{t('print.version')}</dt>
              <dd>v{doc.version}</dd>
            </div>
            <div>
              <dt>{t('print.date')}</dt>
              <dd>{formatDateTime(doc.generatedAt)}</dd>
            </div>
            <div>
              <dt>{t('print.preparedBy')}</dt>
              <dd>{preparedBy.name}</dd>
            </div>
          </dl>
          {sections.length ? (
            <nav className="print-doc__toc" aria-label={t('doc.sections')}>
              <h2>{t('print.contents')}</h2>
              <ol>
                {sections.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </nav>
          ) : null}
        </header>
        <div className="print-doc__body">
          <MarkdownView source={body(doc.contentMd)} />
        </div>
        {preparedBy.whiteLabel ? null : <footer className="print-doc__footer">canvai.dev</footer>}
      </article>
    </div>
  )
}
