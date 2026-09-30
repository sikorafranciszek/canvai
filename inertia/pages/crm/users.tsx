import { Head, Link, router } from '@inertiajs/react'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { NoAnalytics } from '~/components/crm/CrmLayout'
import { formatNumber } from '~/components/crm/charts'
import { formatDateTime, relativeTime } from '~/lib/format'
import { iso } from '~/lib/crm'

interface Row {
  id: number
  email: string
  fullName: string | null
  createdAt: string
  verified: boolean
  disabled: boolean
  tags: string[]
  boards: number
  docs: number
  balance: number
  plan: string
  lastSeen: string | null
  events30d: number
}

interface Props {
  filters: { q: string; plan: string; status: string; tag: string; sort: string; page: number }
  total: number
  pageSize: number
  tags: string[]
  analytics: boolean
  users: Row[]
}

const PLAN: Record<string, string> = { free: 'Free', payg: 'PAYG', pro: 'Pro', team: 'Team' }

export default function CrmUsers(props: Props) {
  const { filters } = props
  const [q, setQ] = useState(filters.q)
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize))

  const go = (patch: Partial<Props['filters']>) => {
    const next = { ...filters, ...patch }
    const qs = Object.fromEntries(
      Object.entries(next).filter(
        ([k, v]) =>
          v !== '' && v != null && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'newest')
      )
    )
    router.get('/users', qs as Record<string, string>, {
      preserveState: true,
      preserveScroll: true,
    })
  }

  return (
    <div className="page crm-page">
      <Head title="CRM — użytkownicy" />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">Użytkownicy</h1>
          <p className="t-muted">{formatNumber(props.total)} kont spełnia kryteria.</p>
        </div>
      </header>
      {!props.analytics ? <NoAnalytics /> : null}

      <form
        className="crm-filters"
        onSubmit={(e) => {
          e.preventDefault()
          go({ q, page: 1 })
        }}
      >
        <label className="input-group" style={{ flex: 1, minWidth: 220 }}>
          <span className="sr-only">Szukaj</span>
          <Search />
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            type="search"
            placeholder="E-mail, imię albo ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="crm-users-search"
          />
        </label>
        <select
          className="select"
          value={filters.plan}
          onChange={(e) => go({ plan: e.target.value, page: 1 })}
          aria-label="Plan"
        >
          <option value="">Wszystkie plany</option>
          <option value="free">Free</option>
          <option value="payg">Pay as you go</option>
          <option value="pro">Pro</option>
        </select>
        <select
          className="select"
          value={filters.status}
          onChange={(e) => go({ status: e.target.value, page: 1 })}
          aria-label="Status"
        >
          <option value="">Każdy status</option>
          <option value="verified">Aktywne</option>
          <option value="unverified">Niepotwierdzone</option>
          <option value="disabled">Zablokowane</option>
        </select>
        {props.tags.length ? (
          <select
            className="select"
            value={filters.tag}
            onChange={(e) => go({ tag: e.target.value, page: 1 })}
            aria-label="Tag"
          >
            <option value="">Każdy tag</option>
            {props.tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className="select"
          value={filters.sort}
          onChange={(e) => go({ sort: e.target.value, page: 1 })}
          aria-label="Sortowanie"
        >
          <option value="newest">Najnowsze</option>
          <option value="oldest">Najstarsze</option>
          <option value="balance">Największe saldo</option>
          <option value="boards">Najwięcej tablic</option>
          <option value="docs">Najwięcej dokumentów</option>
        </select>
      </form>

      <div className="card crm-table-wrap">
        <table className="crm-table" data-testid="crm-users-table">
          <thead>
            <tr>
              <th>Użytkownik</th>
              <th>Plan</th>
              <th className="num">Saldo</th>
              <th className="num">Tablice</th>
              <th className="num">DESIGN.md</th>
              <th>Ostatnio aktywny</th>
              <th>Konto od</th>
            </tr>
          </thead>
          <tbody>
            {props.users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/users/${u.id}`} className="crm-user">
                    <span className="crm-user__name">{u.fullName || u.email.split('@')[0]}</span>
                    <span className="t-small t-faint">{u.email}</span>
                  </Link>
                  <div className="crm-tags">
                    {u.disabled ? <span className="level level--critical">zablokowane</span> : null}
                    {!u.verified ? (
                      <span className="level level--warning">niepotwierdzone</span>
                    ) : null}
                    {u.tags.map((t) => (
                      <span key={t} className="badge">
                        #{t}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge${u.plan === 'free' ? '' : ' badge--accent'}`}>
                    {PLAN[u.plan] ?? u.plan}
                  </span>
                </td>
                <td className="num">{formatNumber(u.balance)}</td>
                <td className="num">{formatNumber(u.boards)}</td>
                <td className="num">{formatNumber(u.docs)}</td>
                <td title={u.lastSeen ? formatDateTime(iso(u.lastSeen)) : ''}>
                  {u.lastSeen ? relativeTime(iso(u.lastSeen)) : <span className="t-faint">—</span>}
                  {u.events30d ? (
                    <span className="t-small t-faint">
                      {' '}
                      · {formatNumber(u.events30d)} zdarzeń/30 d
                    </span>
                  ) : null}
                </td>
                <td title={formatDateTime(iso(u.createdAt))}>{relativeTime(iso(u.createdAt))}</td>
              </tr>
            ))}
            {props.users.length === 0 ? (
              <tr>
                <td colSpan={7} className="t-muted" style={{ textAlign: 'center', padding: 32 }}>
                  Brak użytkowników dla tych filtrów.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="crm-pager" aria-label="Strony">
          <button
            type="button"
            className="btn btn--sm"
            disabled={filters.page <= 1}
            onClick={() => go({ page: filters.page - 1 })}
          >
            ← Poprzednia
          </button>
          <span className="t-small t-muted">
            Strona {filters.page} z {pages}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={filters.page >= pages}
            onClick={() => go({ page: filters.page + 1 })}
          >
            Następna →
          </button>
        </nav>
      ) : null}
    </div>
  )
}
