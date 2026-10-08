import { Head, Link, router } from '@inertiajs/react'
import { NoAnalytics, RangeTabs } from '~/components/crm/CrmLayout'
import { BarList, Stat, TimeChart, formatNumber } from '~/components/crm/charts'

interface Point {
  day: string
  value: number
}

interface DashboardData {
  days: number
  analytics: boolean
  kpis: {
    usersTotal: number
    usersVerified: number
    usersNew: number
    proActive: number
    packBuyers: number
    mrrCents: number
    revenueCents: number
    revenueTotalCents: number
    creditsGranted: number
    creditsSpent: number
    generations: number
    generationsFailed: number
    avgGenerationMs: number | null
    p95GenerationMs: number | null
    dau: number | null
    wau: number | null
    mau: number | null
    errors: number | null
  }
  series: {
    signups: Point[]
    revenue: Point[]
    activeUsers: Point[] | null
    visitors: Point[] | null
    pageViews: Point[] | null
  }
  topRoutes: { route: string; views: number; visitors: number }[] | null
  referrers: { host: string; visits: number }[] | null
  devices: { device: string; count: number }[] | null
}

const usd = (cents: number) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
const secs = (ms: number | null) => (ms == null ? '—' : `${formatNumber(ms / 1000, 1)} s`)
const DEVICE: Record<string, string> = {
  desktop: 'Komputer',
  mobile: 'Telefon',
  tablet: 'Tablet',
  unknown: 'Inne',
  bot: 'Boty',
}

interface Pipeline {
  sink: string
  buffered: number
  dropped: number
  lastFlush: { at: string; ok: boolean; rows: number; error?: string } | null
}

interface SystemStatus {
  backup: { configured: boolean; hourUtc: number; keepDays: number }
  tasks: { task: string; lastRunAt: string | null; status: string | null; message: string | null }[]
  ai: {
    tokensToday: number
    dailyBudget: number
    userDailyGenerations: number
    userDailyTokens: number
    top: { id: number; email: string; generations: number; tokens: number }[]
  }
  alerts: {
    pending: number
    webhook: boolean
    recent: { at: string; text: string }[]
    log: { key: string; message: string; count: number; firstAt: string; lastAt: string }[]
  }
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—'

function SystemCard({ system }: { system: SystemStatus }) {
  const backup = system.tasks.find((t) => t.task === 'backup')
  const budgetPct = system.ai.dailyBudget
    ? Math.round((system.ai.tokensToday / system.ai.dailyBudget) * 100)
    : null
  const backupTone = !system.backup.configured
    ? 'critical'
    : backup?.status === 'failed'
      ? 'critical'
      : backup?.status === 'ok'
        ? 'good'
        : 'warning'
  return (
    <section className="card crm-card crm-system" data-testid="crm-system">
      <h2 className="crm-card__title">System</h2>
      <dl className="crm-system__list">
        <div>
          <dt>Kopie zapasowe</dt>
          <dd>
            <span className={`level level--${backupTone}`}>
              {!system.backup.configured
                ? 'nieskonfigurowane'
                : backup?.status === 'failed'
                  ? 'ostatnia nieudana'
                  : backup?.status === 'running'
                    ? 'w toku'
                    : backup?.status === 'ok'
                      ? 'OK'
                      : 'jeszcze nie było'}
            </span>{' '}
            <span className="t-small t-muted">
              {system.backup.configured
                ? `codziennie ${system.backup.hourUtc}:00 UTC, trzymane ${system.backup.keepDays} dni · ostatnia ${when(backup?.lastRunAt ?? null)}`
                : 'ustaw BACKUP_S3_* w Coolify'}
            </span>
            {backup?.message ? <div className="t-small t-muted">{backup.message}</div> : null}
            {system.backup.configured ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => router.post('/backup')}
              >
                Zrób kopię teraz
              </button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Zużycie AI dziś</dt>
          <dd>
            {formatNumber(system.ai.tokensToday)} tokenów
            {budgetPct != null ? (
              <span className={`level level--${budgetPct >= 80 ? 'critical' : 'good'}`}>
                {' '}
                {budgetPct}% limitu dziennego
              </span>
            ) : null}
            <div className="t-small t-muted">
              Limity na konto: {system.ai.userDailyGenerations || '∞'} generacji,{' '}
              {system.ai.userDailyTokens ? formatNumber(system.ai.userDailyTokens) : '∞'} tokenów
              dziennie
            </div>
            {system.ai.top.length ? (
              <ul className="crm-system__top t-small">
                {system.ai.top.map((u) => (
                  <li key={u.id}>
                    <Link href={`/users/${u.id}`}>{u.email}</Link> — {formatNumber(u.tokens)} tok.,{' '}
                    {u.generations} gen.
                  </li>
                ))}
              </ul>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Alerty</dt>
          <dd>
            {system.alerts.pending ? `${system.alerts.pending} czeka na wysyłkę · ` : ''}
            mail do administratorów{system.alerts.webhook ? ' + webhook' : ''}
            {system.alerts.recent.length ? (
              <details className="t-small">
                <summary>Ostatnie ({system.alerts.recent.length})</summary>
                {system.alerts.recent.map((a) => (
                  <pre key={a.at} className="crm-system__alert">
                    {when(a.at)}
                    {'\n'}
                    {a.text}
                  </pre>
                ))}
              </details>
            ) : null}
            {system.alerts.log.length ? (
              <details className="t-small">
                <summary>Dziennik alertów ({system.alerts.log.length})</summary>
                <ul className="crm-system__alerts">
                  {system.alerts.log.map((a) => (
                    <li key={a.key}>
                      <b>×{a.count}</b> {when(a.lastAt)} — {a.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export default function CrmDashboard({
  range,
  data,
  pipeline,
  system,
}: {
  range: string
  data: DashboardData
  pipeline: Pipeline
  system: SystemStatus
}) {
  const k = data.kpis
  const failRate = k.generations ? Math.round((k.generationsFailed / k.generations) * 100) : 0

  return (
    <div className="page crm-page">
      <Head title="CRM — pulpit" />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">Pulpit</h1>
          <p className="t-muted">
            Użytkownicy, przychody i aktywność w canvai — ostatnie {data.days} dni.
          </p>
        </div>
        <RangeTabs value={range} base="/" />
      </header>

      {!data.analytics ? <NoAnalytics /> : null}
      {pipeline.sink === 'clickhouse' ? (
        <p className="crm-pipeline t-small" data-testid="crm-pipeline">
          <span
            className={`level level--${pipeline.lastFlush && !pipeline.lastFlush.ok ? 'critical' : 'good'}`}
          >
            {pipeline.lastFlush && !pipeline.lastFlush.ok
              ? 'zapis do ClickHouse nie działa'
              : 'ClickHouse OK'}
          </span>
          <span className="t-muted">
            w buforze {formatNumber(pipeline.buffered)}
            {pipeline.dropped ? ` · odrzucone ${formatNumber(pipeline.dropped)}` : ''}
            {pipeline.lastFlush
              ? ` · ostatni zapis ${new Date(pipeline.lastFlush.at).toLocaleTimeString('pl-PL')}`
              : ''}
            {pipeline.lastFlush?.error ? ` · ${pipeline.lastFlush.error}` : ''}
          </span>
        </p>
      ) : null}

      <section className="stats" aria-label="Najważniejsze liczby">
        <Stat
          label="Użytkownicy"
          value={formatNumber(k.usersTotal)}
          hint={`+${formatNumber(k.usersNew)} w okresie · ${formatNumber(k.usersVerified)} potwierdzonych`}
        />
        <Stat
          label="Aktywni (DAU / WAU / MAU)"
          value={
            k.dau == null
              ? '—'
              : `${formatNumber(k.dau)} / ${formatNumber(k.wau)} / ${formatNumber(k.mau)}`
          }
          hint="zalogowani, którzy coś zrobili"
        />
        <Stat
          label="MRR (Pro)"
          value={usd(k.mrrCents)}
          hint={`${formatNumber(k.proActive)} aktywnych subskrypcji`}
        />
        <Stat
          label="Przychód w okresie"
          value={usd(k.revenueCents)}
          hint={`łącznie ${usd(k.revenueTotalCents)} · ${formatNumber(k.packBuyers)} kupujących pakiety`}
        />
        <Stat
          label="Generacje DESIGN.md"
          value={formatNumber(k.generations)}
          hint={`${failRate}% nieudanych · śr. ${secs(k.avgGenerationMs)} · p95 ${secs(k.p95GenerationMs)}`}
          tone={failRate > 10 ? 'critical' : undefined}
        />
        <Stat
          label="Kredyty"
          value={`${formatNumber(k.creditsSpent)} zużytych`}
          hint={`${formatNumber(k.creditsGranted)} przyznanych w okresie`}
        />
        <Stat
          label="Błędy aplikacji"
          value={k.errors == null ? '—' : formatNumber(k.errors)}
          hint={<Link href="/logs">Zobacz logi →</Link>}
          tone={k.errors ? 'critical' : 'good'}
        />
      </section>

      <div className="crm-grid">
        <SystemCard system={system} />
        <section className="card crm-card">
          <h2 className="crm-card__title">Nowe konta dziennie</h2>
          <TimeChart
            kind="column"
            label="Nowe konta dziennie"
            series={[{ name: 'Rejestracje', points: data.series.signups }]}
          />
        </section>
        <section className="card crm-card">
          <h2 className="crm-card__title">Aktywni użytkownicy i odwiedzający</h2>
          {data.series.activeUsers && data.series.visitors ? (
            <TimeChart
              label="Aktywni użytkownicy i odwiedzający dziennie"
              series={[
                { name: 'Odwiedzający (unikalni)', points: data.series.visitors },
                { name: 'Zalogowani aktywni', points: data.series.activeUsers },
              ]}
            />
          ) : (
            <p className="t-small t-muted">Wymaga bazy analitycznej.</p>
          )}
        </section>
        <section className="card crm-card">
          <h2 className="crm-card__title">Przychód dziennie (wg cennika)</h2>
          <TimeChart
            kind="column"
            label="Przychód dziennie"
            format={(v) => usd(v * 100)}
            series={[{ name: 'Przychód', points: data.series.revenue }]}
          />
        </section>
        <section className="card crm-card">
          <h2 className="crm-card__title">Najczęściej odwiedzane strony</h2>
          {data.topRoutes ? (
            <BarList
              rows={data.topRoutes.map((r) => ({ label: <code>{r.route}</code>, value: r.views }))}
              secondary={(i) => `· ${formatNumber(data.topRoutes![i].visitors)} os.`}
            />
          ) : (
            <p className="t-small t-muted">Wymaga bazy analitycznej.</p>
          )}
        </section>
        <section className="card crm-card">
          <h2 className="crm-card__title">Skąd przychodzą</h2>
          {data.referrers ? (
            <BarList
              rows={data.referrers.map((r) => ({ label: r.host, value: r.visits }))}
              empty="Brak wejść z innych stron"
            />
          ) : (
            <p className="t-small t-muted">Wymaga bazy analitycznej.</p>
          )}
        </section>
        <section className="card crm-card">
          <h2 className="crm-card__title">Urządzenia</h2>
          {data.devices ? (
            <BarList
              rows={data.devices.map((r) => ({
                label: DEVICE[r.device] ?? r.device,
                value: r.count,
              }))}
            />
          ) : (
            <p className="t-small t-muted">Wymaga bazy analitycznej.</p>
          )}
        </section>
      </div>
    </div>
  )
}
