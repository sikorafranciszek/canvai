import { Head, Link, router } from '@inertiajs/react'
import { NoAnalytics, RangeTabs } from '~/components/crm/CrmLayout'
import { BarList, RetentionHeatmap, TimeChart, formatNumber } from '~/components/crm/charts'
import { STEP_LABELS, eventLabel, iso, propsSummary } from '~/lib/crm'
import { relativeTime } from '~/lib/format'

interface Props {
  range: string
  event: string
  analytics: boolean
  eventTypes: { event: string; count: number; users: number }[] | null
  series: { day: string; value: number }[] | null
  funnel: { step: string; users: number }[] | null
  funnelSteps: string[]
  retention: { cohort: string; size: number; weeks: number[] }[] | null
  recent:
    | {
        ts: string
        event: string
        user_id: number
        route: string
        path: string
        device: string
        browser: string
        props: string
      }[]
    | null
}

export default function CrmAnalytics(p: Props) {
  const first = p.funnel?.[0]?.users ?? 0
  return (
    <div className="page crm-page">
      <Head title="CRM — analityka" />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">Analityka</h1>
          <p className="t-muted">Lejek aktywacji, retencja kohort i zdarzenia produktu.</p>
        </div>
        <RangeTabs value={p.range} base="/analytics" extra={{ event: p.event }} />
      </header>

      {!p.analytics ? (
        <NoAnalytics />
      ) : (
        <>
          <div className="crm-grid crm-grid--2">
            <section className="card crm-card" data-testid="crm-funnel">
              <h2 className="crm-card__title">Lejek aktywacji</h2>
              <p className="t-small t-muted">
                Zalogowani użytkownicy, którzy w okresie doszli co najmniej do danego kroku (w tej
                kolejności).
              </p>
              {p.funnel ? (
                <BarList
                  rows={p.funnel.map((s) => ({
                    label: STEP_LABELS[s.step] ?? s.step,
                    value: s.users,
                  }))}
                  secondary={(i) =>
                    first ? `· ${Math.round(((p.funnel![i].users || 0) / first) * 100)}%` : ''
                  }
                />
              ) : null}
            </section>
            <section className="card crm-card" data-testid="crm-retention">
              <h2 className="crm-card__title">Retencja tygodniowa</h2>
              <p className="t-small t-muted">
                Odsetek osób z kohorty rejestracji aktywnych w kolejnych tygodniach.
              </p>
              {p.retention?.length ? (
                <RetentionHeatmap rows={p.retention} />
              ) : (
                <p className="t-small t-muted">
                  Za mało danych — potrzebne są rejestracje z ostatnich tygodni.
                </p>
              )}
            </section>
          </div>

          <section className="card crm-card">
            <div className="crm-card__head">
              <h2 className="crm-card__title">Zdarzenie w czasie</h2>
              <select
                className="select"
                value={p.event}
                onChange={(e) =>
                  router.get(
                    '/analytics',
                    { range: p.range, event: e.target.value },
                    { preserveScroll: true }
                  )
                }
                aria-label="Zdarzenie"
                data-testid="crm-event-select"
              >
                {(p.eventTypes ?? []).map((e) => (
                  <option key={e.event} value={e.event}>
                    {eventLabel(e.event)} ({formatNumber(e.count)})
                  </option>
                ))}
              </select>
            </div>
            {p.series ? (
              <TimeChart
                kind="column"
                label={`Zdarzenie ${p.event} dziennie`}
                series={[{ name: eventLabel(p.event), points: p.series }]}
              />
            ) : null}
          </section>

          <div className="crm-grid crm-grid--2">
            <section className="card crm-card">
              <h2 className="crm-card__title">Wszystkie zdarzenia</h2>
              <BarList
                rows={(p.eventTypes ?? []).map((e) => ({
                  label: (
                    <Link href={`/analytics?range=${p.range}&event=${encodeURIComponent(e.event)}`}>
                      {eventLabel(e.event)}
                    </Link>
                  ),
                  value: e.count,
                }))}
                secondary={(i) => `· ${formatNumber(p.eventTypes![i].users)} os.`}
              />
            </section>
            <section className="card crm-card">
              <h2 className="crm-card__title">Ostatnie: {eventLabel(p.event)}</h2>
              <ul className="crm-log-list">
                {(p.recent ?? []).map((e, i) => (
                  <li key={i}>
                    {e.user_id ? (
                      <Link href={`/users/${e.user_id}`}>użytkownik #{e.user_id}</Link>
                    ) : (
                      <span className="t-faint">anonim</span>
                    )}
                    <span className="t-small t-faint">
                      {' '}
                      · {relativeTime(iso(e.ts))} · {e.route || e.path} · {e.device} {e.browser}
                    </span>
                    {propsSummary(e.props) ? (
                      <div className="t-small t-muted">{propsSummary(e.props)}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
