import { Head, Link, router } from '@inertiajs/react'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { NoAnalytics, RangeTabs } from '~/components/crm/CrmLayout'
import { LevelBadge, Stat, TimeChart, formatNumber } from '~/components/crm/charts'
import { iso } from '~/lib/crm'
import { relativeTime } from '~/lib/format'

interface Props {
  range: string
  tab: 'errors' | 'logs' | 'requests'
  filters: { level: string; q: string; user: number | '' }
  analytics: boolean
  levels: { level: string; count: number }[] | null
  logs:
    | {
        ts: string
        level: string
        msg: string
        request_id: string
        user_id: number
        route: string
        err_name: string
        err_message: string
        err_stack: string
        context: string
      }[]
    | null
  errorGroups:
    | {
        name: string
        message: string
        n: number
        last_seen: string
        users: number
        route: string
      }[]
    | null
  routes:
    | {
        method: string
        route: string
        n: number
        p50: number
        p95: number
        errors: number
        client_errors: number
      }[]
    | null
  requestSeries: {
    requests: { day: string; value: number }[]
    errors: { day: string; value: number }[]
  } | null
}

const TABS = [
  ['errors', 'Błędy'],
  ['logs', 'Logi'],
  ['requests', 'Żądania'],
] as const

export default function CrmLogs(p: Props) {
  const [q, setQ] = useState(p.filters.q)
  const [open, setOpen] = useState<number | null>(null)
  const count = (lvl: string) => p.levels?.find((l) => l.level === lvl)?.count ?? 0
  const go = (patch: Record<string, string | number>) =>
    router.get(
      '/logs',
      {
        range: p.range,
        tab: p.tab,
        level: p.filters.level,
        q: p.filters.q,
        user: p.filters.user,
        ...patch,
      },
      { preserveScroll: true }
    )

  return (
    <div className="page crm-page">
      <Head title="CRM — logi" />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">Logi</h1>
          <p className="t-muted">
            Błędy aplikacji, logi serwera i wydajność tras (przechowywane 90 dni).
          </p>
        </div>
        <RangeTabs value={p.range} base="/logs" extra={{ tab: p.tab }} />
      </header>

      {!p.analytics ? (
        <NoAnalytics />
      ) : (
        <>
          <section className="stats">
            <Stat
              label="Błędy"
              value={formatNumber(count('error') + count('fatal'))}
              tone={count('error') + count('fatal') ? 'critical' : 'good'}
            />
            <Stat label="Ostrzeżenia" value={formatNumber(count('warn'))} />
            <Stat label="Informacje" value={formatNumber(count('info'))} />
            <Stat
              label="Żądania"
              value={formatNumber(p.requestSeries?.requests.reduce((a, r) => a + r.value, 0) ?? 0)}
              hint={`${formatNumber(p.requestSeries?.errors.reduce((a, r) => a + r.value, 0) ?? 0)} z błędem 5xx`}
            />
          </section>

          {p.requestSeries ? (
            <section className="card crm-card">
              <h2 className="crm-card__title">Żądania dziennie</h2>
              <TimeChart
                label="Żądania i błędy 5xx dziennie"
                series={[
                  { name: 'Wszystkie żądania', points: p.requestSeries.requests },
                  { name: 'Błędy 5xx', points: p.requestSeries.errors },
                ]}
              />
            </section>
          ) : null}

          <div className="crm-tabs" role="tablist">
            {TABS.map(([key, label]) => (
              <Link
                key={key}
                href={`/logs?range=${p.range}&tab=${key}`}
                role="tab"
                aria-selected={p.tab === key}
                className="crm-tab"
              >
                {label}
              </Link>
            ))}
          </div>

          {p.tab === 'errors' ? (
            <section className="card crm-table-wrap" data-testid="crm-error-groups">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Błąd</th>
                    <th className="num">Wystąpienia</th>
                    <th className="num">Użytkownicy</th>
                    <th>Ostatnio</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.errorGroups ?? []).map((g, i) => (
                    <tr key={i}>
                      <td>
                        <LevelBadge level="error" /> <strong>{g.name}</strong>
                        <div className="t-small">
                          <Link
                            href={`/logs?range=${p.range}&tab=logs&level=error&q=${encodeURIComponent(g.message.slice(0, 60))}`}
                          >
                            {g.message}
                          </Link>
                        </div>
                        {g.route ? <code className="t-small t-faint">{g.route}</code> : null}
                      </td>
                      <td className="num">{formatNumber(g.n)}</td>
                      <td className="num">{formatNumber(g.users)}</td>
                      <td>{relativeTime(iso(g.last_seen))}</td>
                    </tr>
                  ))}
                  {p.errorGroups?.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="t-muted"
                        style={{ textAlign: 'center', padding: 28 }}
                      >
                        Brak błędów w tym okresie.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {p.tab === 'logs' ? (
            <>
              <form
                className="crm-filters"
                onSubmit={(e) => {
                  e.preventDefault()
                  go({ q })
                }}
              >
                <label className="input-group" style={{ flex: 1, minWidth: 220 }}>
                  <span className="sr-only">Szukaj w logach</span>
                  <Search />
                  <input
                    className="input"
                    style={{ paddingLeft: 36 }}
                    type="search"
                    placeholder="Treść, błąd albo ID żądania"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    data-testid="crm-logs-search"
                  />
                </label>
                <select
                  className="select"
                  value={p.filters.level}
                  onChange={(e) => go({ level: e.target.value })}
                  aria-label="Poziom"
                >
                  <option value="">Wszystkie poziomy</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                  <option value="fatal">fatal</option>
                </select>
              </form>
              <section className="card crm-table-wrap" data-testid="crm-logs">
                <table className="crm-table crm-table--compact">
                  <thead>
                    <tr>
                      <th>Kiedy</th>
                      <th>Poziom</th>
                      <th>Wiadomość</th>
                      <th>Kontekst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(p.logs ?? []).map((l, i) => (
                      <tr
                        key={i}
                        onClick={() => setOpen(open === i ? null : i)}
                        className="crm-log-row"
                      >
                        <td title={l.ts}>{relativeTime(iso(l.ts))}</td>
                        <td>
                          <LevelBadge level={l.level} />
                        </td>
                        <td>
                          <div>{l.err_message || l.msg}</div>
                          {open === i && (l.err_stack || l.context) ? (
                            <pre className="crm-pre">{l.err_stack || l.context}</pre>
                          ) : null}
                        </td>
                        <td className="t-small t-faint">
                          {l.route ? <code>{l.route}</code> : null}
                          {l.user_id ? (
                            <>
                              {' '}
                              · <Link href={`/users/${l.user_id}`}>#{l.user_id}</Link>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {p.logs?.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="t-muted"
                          style={{ textAlign: 'center', padding: 28 }}
                        >
                          Nic nie pasuje do filtrów.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            </>
          ) : null}

          {p.tab === 'requests' ? (
            <section className="card crm-table-wrap" data-testid="crm-routes">
              <table className="crm-table crm-table--compact">
                <thead>
                  <tr>
                    <th>Trasa</th>
                    <th className="num">Żądania</th>
                    <th className="num">p50</th>
                    <th className="num">p95</th>
                    <th className="num">4xx</th>
                    <th className="num">5xx</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.routes ?? []).map((r, i) => (
                    <tr key={i}>
                      <td>
                        <span className="badge">{r.method}</span> <code>{r.route}</code>
                      </td>
                      <td className="num">{formatNumber(r.n)}</td>
                      <td className="num">{formatNumber(r.p50, 1)} ms</td>
                      <td className={`num${r.p95 > 1000 ? ' is-warn' : ''}`}>
                        {formatNumber(r.p95, 1)} ms
                      </td>
                      <td className="num">{formatNumber(r.client_errors)}</td>
                      <td className="num">
                        {r.errors ? <LevelBadge level="error" /> : null} {formatNumber(r.errors)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
