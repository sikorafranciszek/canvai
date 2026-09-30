import { Form } from '@adonisjs/inertia/react'
import { Head, Link } from '@inertiajs/react'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Coins,
  ExternalLink,
  KeyRound,
  MailCheck,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '~/components/ui/Dialog'
import { NoAnalytics } from '~/components/crm/CrmLayout'
import { BarList, LevelBadge, Stat, formatNumber } from '~/components/crm/charts'
import { eventLabel, iso, propsSummary } from '~/lib/crm'
import { formatDateTime, relativeTime } from '~/lib/format'

interface Props {
  appUrl: string
  analytics: boolean
  profile: {
    id: number
    email: string
    fullName: string | null
    locale: string | null
    createdAt: string | null
    emailVerifiedAt: string | null
    disabledAt: string | null
    tags: string[]
    isAdmin: boolean
    referralCode: string | null
    referredBy: { id: number; email: string } | null
    lastSeen: string | null
  }
  plan: string
  limits: { boards: number | null; materialsPerBoard: number | null }
  balance: number
  nextExpiry: { amount: number; expiresAt: string } | null
  apiTokens: number
  referral: { invited: number; earned: number }
  subscriptions: {
    id: number
    plan: string
    status: string
    externalId: string
    renewsAt: string | null
    endsAt: string | null
    createdAt: string | null
  }[]
  grants: {
    id: number
    source: string
    amount: number
    remaining: number
    expiresAt: string | null
    revokedAt: string | null
    externalId: string | null
    createdAt: string | null
  }[]
  transactions: {
    id: number
    kind: string
    amount: number
    note: string | null
    designDocId: number | null
    createdAt: string | null
  }[]
  boards: {
    id: number
    title: string
    createdAt: string
    updatedAt: string
    assets: number
    docs: number
    lastStatus: string | null
    shared: boolean
  }[]
  notes: { id: number; body: string; author: string | null; createdAt: string | null }[]
  timeline:
    | {
        ts: string
        event: string
        route: string
        path: string
        device: string
        browser: string
        os: string
        props: string
        board_id: number
      }[]
    | null
  errors:
    | {
        ts: string
        level: string
        msg: string
        err_message: string
        route: string
        request_id: string
      }[]
    | null
  eventCounts: { event: string; count: number }[] | null
}

const PLAN: Record<string, string> = {
  free: 'Free',
  payg: 'Pay as you go',
  pro: 'Pro',
  team: 'Team',
}
const SOURCE: Record<string, string> = {
  signup: 'powitalne',
  monthly_free: 'miesięczne Free',
  pack: 'pakiet',
  subscription: 'subskrypcja',
  referral: 'polecenie',
  admin: 'od administratora',
}
const DOC_STATUS: Record<string, string> = {
  ready: 'gotowy',
  failed: 'błąd',
  queued: 'w kolejce',
  running: 'w toku',
}
const KIND: Record<string, string> = {
  grant: 'przyznanie',
  revoke: 'cofnięcie',
  reserve: 'generacja',
  release: 'zwrot',
}

export default function CrmUser(p: Props) {
  const u = p.profile
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tags, setTags] = useState(u.tags.join(', '))

  return (
    <div className="page crm-page">
      <Head title={`CRM — ${u.email}`} />
      <Link href="/users" className="crm-back">
        <ArrowLeft size={14} /> Użytkownicy
      </Link>

      <header className="crm-user-head">
        <div>
          <h1 className="t-display">{u.fullName || u.email.split('@')[0]}</h1>
          <p className="t-muted">
            {u.email} · ID {u.id} · konto od {formatDateTime(u.createdAt)}
            {u.lastSeen ? ` · ostatnio aktywny ${relativeTime(iso(u.lastSeen))}` : ''}
          </p>
          <div className="crm-tags" style={{ marginTop: 8 }}>
            <span className={`badge${p.plan === 'free' ? '' : ' badge--accent'}`}>
              {PLAN[p.plan] ?? p.plan}
            </span>
            {u.emailVerifiedAt ? (
              <span className="level level--good">e-mail potwierdzony</span>
            ) : (
              <span className="level level--warning">e-mail niepotwierdzony</span>
            )}
            {u.disabledAt ? (
              <span className="level level--critical">
                zablokowane {relativeTime(u.disabledAt)}
              </span>
            ) : null}
            {u.isAdmin ? <span className="badge">administrator</span> : null}
            {u.tags.map((t) => (
              <span key={t} className="badge">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="crm-actions">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => setCreditsOpen(true)}
            data-testid="crm-grant-open"
          >
            <Coins /> Przyznaj kredyty
          </button>
          {!u.emailVerifiedAt ? (
            <Form route="crm.user.verify" routeParams={{ id: u.id }} method="post">
              <button type="submit" className="btn btn--sm">
                <MailCheck /> Potwierdź e-mail
              </button>
            </Form>
          ) : null}
          <Form route="crm.user.reset" routeParams={{ id: u.id }} method="post">
            <button type="submit" className="btn btn--sm">
              <KeyRound /> Reset hasła
            </button>
          </Form>
          {u.disabledAt ? (
            <Form route="crm.user.enable" routeParams={{ id: u.id }} method="post">
              <button type="submit" className="btn btn--sm" data-testid="crm-enable">
                <UserCheck /> Odblokuj
              </button>
            </Form>
          ) : (
            <Form route="crm.user.disable" routeParams={{ id: u.id }} method="post">
              <button type="submit" className="btn btn--sm" data-testid="crm-disable">
                <Ban /> Zablokuj
              </button>
            </Form>
          )}
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => setDeleteOpen(true)}
            data-testid="crm-delete-open"
          >
            <Trash2 /> Usuń konto
          </button>
        </div>
      </header>

      {!p.analytics ? <NoAnalytics /> : null}

      <section className="stats">
        <Stat
          label="Saldo kredytów"
          value={formatNumber(p.balance)}
          hint={
            p.nextExpiry
              ? `${formatNumber(p.nextExpiry.amount)} wygasa ${formatDateTime(p.nextExpiry.expiresAt)}`
              : 'bez wygasających'
          }
        />
        <Stat
          label="Tablice"
          value={formatNumber(p.boards.length)}
          hint={p.limits.boards == null ? 'bez limitu' : `limit planu: ${p.limits.boards}`}
        />
        <Stat
          label="Wersje DESIGN.md"
          value={formatNumber(p.boards.reduce((a, b) => a + b.docs, 0))}
        />
        <Stat
          label="Polecenia"
          value={formatNumber(p.referral.invited)}
          hint={`${formatNumber(p.referral.earned)} kredytów za polecenia${u.referredBy ? ` · polecony przez ${u.referredBy.email}` : ''}`}
        />
        <Stat
          label="Tokeny API"
          value={formatNumber(p.apiTokens)}
          hint={`język: ${u.locale ?? 'auto'}`}
        />
      </section>

      <div className="crm-cols">
        <div className="crm-col">
          <section className="card crm-card">
            <h2 className="crm-card__title">Tablice</h2>
            {p.boards.length ? (
              <table className="crm-table crm-table--compact">
                <thead>
                  <tr>
                    <th>Tytuł</th>
                    <th className="num">Materiały</th>
                    <th className="num">Wersje</th>
                    <th>Ostatnia generacja</th>
                    <th>Zmieniona</th>
                  </tr>
                </thead>
                <tbody>
                  {p.boards.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.title} {b.shared ? <span className="badge">portal</span> : null}
                      </td>
                      <td className="num">{b.assets}</td>
                      <td className="num">{b.docs}</td>
                      <td>
                        {b.lastStatus ? (
                          <span
                            className={`level level--${b.lastStatus === 'failed' ? 'critical' : b.lastStatus === 'ready' ? 'good' : 'neutral'}`}
                          >
                            {DOC_STATUS[b.lastStatus] ?? b.lastStatus}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{relativeTime(iso(b.updatedAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="t-small t-muted">Brak tablic.</p>
            )}
          </section>

          <section className="card crm-card">
            <h2 className="crm-card__title">Pule kredytów</h2>
            <table className="crm-table crm-table--compact">
              <thead>
                <tr>
                  <th>Źródło</th>
                  <th className="num">Przyznano</th>
                  <th className="num">Pozostało</th>
                  <th>Wygasa</th>
                  <th>Kiedy</th>
                </tr>
              </thead>
              <tbody>
                {p.grants.map((g) => (
                  <tr key={g.id} className={g.revokedAt ? 'is-muted' : undefined}>
                    <td>
                      {SOURCE[g.source] ?? g.source}
                      {g.revokedAt ? <span className="level level--critical">cofnięte</span> : null}
                    </td>
                    <td className="num">{formatNumber(g.amount)}</td>
                    <td className="num">{formatNumber(g.remaining)}</td>
                    <td>{g.expiresAt ? formatDateTime(g.expiresAt) : 'nigdy'}</td>
                    <td>{relativeTime(g.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card crm-card">
            <h2 className="crm-card__title">Historia kredytów</h2>
            <ul className="history">
              {p.transactions.map((t) => (
                <li key={t.id}>
                  <span className="history__what">
                    {KIND[t.kind] ?? t.kind}
                    {t.note ? <span className="t-faint t-small"> · {t.note}</span> : null}
                    <span className="t-faint t-small">{relativeTime(t.createdAt)}</span>
                  </span>
                  <span
                    className={`history__amount${t.amount > 0 ? ' history__amount--plus' : ''}`}
                  >
                    {t.amount > 0 ? '+' : '−'}
                    {Math.abs(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {p.subscriptions.length ? (
            <section className="card crm-card">
              <h2 className="crm-card__title">Subskrypcje (Polar)</h2>
              <table className="crm-table crm-table--compact">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Odnowienie / koniec</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {p.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td>{PLAN[s.plan] ?? s.plan}</td>
                      <td>{s.status}</td>
                      <td>
                        {s.endsAt
                          ? `koniec ${formatDateTime(s.endsAt)}`
                          : s.renewsAt
                            ? formatDateTime(s.renewsAt)
                            : '—'}
                      </td>
                      <td>
                        <code className="t-small">{s.externalId}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>

        <div className="crm-col">
          <section className="card crm-card">
            <h2 className="crm-card__title">Tagi</h2>
            <Form
              route="crm.user.tags"
              routeParams={{ id: u.id }}
              method="put"
              transform={(data: any) => ({
                tags: String(data.tags ?? '')
                  .split(',')
                  .map((t: string) => t.trim())
                  .filter(Boolean),
              })}
            >
              {({ processing }: { processing: boolean }) => (
                <div className="crm-inline">
                  <input
                    className="input"
                    name="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="np. agencja, beta, vip"
                    data-testid="crm-tags-input"
                  />
                  <button type="submit" className="btn" disabled={processing}>
                    Zapisz
                  </button>
                </div>
              )}
            </Form>
          </section>

          <section className="card crm-card">
            <h2 className="crm-card__title">Notatki zespołu</h2>
            <Form route="crm.user.notes" routeParams={{ id: u.id }} method="post" resetOnSuccess>
              {({ processing }: { processing: boolean }) => (
                <div className="settings-form">
                  <textarea
                    className="input textarea"
                    name="body"
                    rows={3}
                    placeholder="Np. rozmowa o planie Team, prośba o fakturę…"
                    required
                    data-testid="crm-note-input"
                  />
                  <button
                    type="submit"
                    className="btn btn--sm"
                    style={{ alignSelf: 'flex-end' }}
                    disabled={processing}
                  >
                    Dodaj notatkę
                  </button>
                </div>
              )}
            </Form>
            <ul className="crm-notes">
              {p.notes.map((n) => (
                <li key={n.id}>
                  <p>{n.body}</p>
                  <span className="t-small t-faint">
                    {n.author ?? '—'} · {relativeTime(n.createdAt)}
                  </span>
                  <Form
                    route="crm.user.notes.destroy"
                    routeParams={{ id: u.id, noteId: n.id }}
                    method="delete"
                  >
                    <button
                      type="submit"
                      className="btn btn--quiet btn--icon btn--sm"
                      aria-label="Usuń notatkę"
                    >
                      <Trash2 />
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>

          <section className="card crm-card">
            <h2 className="crm-card__title">Aktywność (90 dni)</h2>
            {p.eventCounts ? (
              <BarList
                rows={p.eventCounts
                  .slice(0, 8)
                  .map((e) => ({ label: eventLabel(e.event), value: e.count }))}
                empty="Brak zdarzeń"
              />
            ) : (
              <p className="t-small t-muted">Wymaga bazy analitycznej.</p>
            )}
          </section>

          <section className="card crm-card">
            <h2 className="crm-card__title">Oś czasu</h2>
            {p.timeline?.length ? (
              <ol className="timeline" data-testid="crm-timeline">
                {p.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="timeline__dot" />
                    <div>
                      <strong>{eventLabel(e.event)}</strong>
                      <span className="t-small t-faint">
                        {' '}
                        · {relativeTime(iso(e.ts))} · {e.route || e.path}
                        {e.device ? ` · ${e.device}, ${e.browser}` : ''}
                      </span>
                      {propsSummary(e.props) ? (
                        <div className="t-small t-muted">{propsSummary(e.props)}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="t-small t-muted">
                {p.timeline ? 'Brak zdarzeń.' : 'Wymaga bazy analitycznej.'}
              </p>
            )}
          </section>

          {p.errors?.length ? (
            <section className="card crm-card">
              <h2 className="crm-card__title">
                <AlertTriangle size={16} /> Błędy tego użytkownika
              </h2>
              <ul className="crm-log-list">
                {p.errors.map((e, i) => (
                  <li key={i}>
                    <LevelBadge level={e.level} /> <strong>{e.err_message || e.msg}</strong>
                    <div className="t-small t-faint">
                      {relativeTime(iso(e.ts))} · {e.route} ·{' '}
                      <Link href={`/logs?tab=logs&q=${encodeURIComponent(e.request_id)}`}>
                        żądanie
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <a
            className="t-small crm-applink"
            href={p.appUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Otwórz aplikację <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <Dialog
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        title="Przyznaj kredyty"
        description={`Dla ${u.email}. Trafią do osobnej puli „od administratora”.`}
        testId="crm-credits-dialog"
      >
        <Form
          route="crm.user.credits"
          routeParams={{ id: u.id }}
          method="post"
          onSuccess={() => setCreditsOpen(false)}
        >
          {({ errors, processing }: { errors: Record<string, string>; processing: boolean }) => (
            <div className="settings-form">
              <div className="field">
                <label className="field__label" htmlFor="crm-amount">
                  Liczba kredytów
                </label>
                <input
                  className="input"
                  id="crm-amount"
                  name="amount"
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={50}
                  required
                />
                {errors.amount ? <div className="field__error">{errors.amount}</div> : null}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="crm-note">
                  Powód (widoczny w historii)
                </label>
                <input
                  className="input"
                  id="crm-note"
                  name="note"
                  maxLength={200}
                  placeholder="np. rekompensata za awarię"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="crm-exp">
                  Ważność
                </label>
                <select className="select" id="crm-exp" name="expiresMonths" defaultValue="12">
                  <option value="1">1 miesiąc</option>
                  <option value="3">3 miesiące</option>
                  <option value="12">12 miesięcy</option>
                  <option value="0">bez terminu</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setCreditsOpen(false)}>
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={processing}
                  data-testid="crm-grant-submit"
                >
                  Przyznaj
                </button>
              </div>
            </div>
          )}
        </Form>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Usunąć konto?"
        description="Nieodwracalne: tablice, pliki, dokumenty, kredyty, tokeny i dane analityczne tego użytkownika zostaną usunięte (prawo do usunięcia danych — RODO)."
        testId="crm-delete-dialog"
      >
        <Form route="crm.user.destroy" routeParams={{ id: u.id }} method="delete">
          {({ processing }: { processing: boolean }) => (
            <div className="settings-form">
              <div className="field">
                <label className="field__label" htmlFor="crm-confirm">
                  Wpisz <strong>{u.email}</strong>, aby potwierdzić
                </label>
                <input
                  className="input"
                  id="crm-confirm"
                  name="confirmEmail"
                  autoComplete="off"
                  required
                  data-testid="crm-delete-confirm"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setDeleteOpen(false)}>
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="btn btn--danger"
                  disabled={processing}
                  data-testid="crm-delete-submit"
                >
                  <Trash2 /> Usuń na zawsze
                </button>
              </div>
            </div>
          )}
        </Form>
      </Dialog>
    </div>
  )
}
