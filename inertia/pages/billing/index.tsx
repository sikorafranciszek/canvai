import { Form, Link } from '@adonisjs/inertia/react'
import { Head, router } from '@inertiajs/react'
import { toast } from 'sonner'
import {
  Check,
  Coins,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { formatDateTime, relativeTime } from '~/lib/format'
import { useT, type MessageKey } from '~/i18n'
import type { PlanId, PlanLimits } from '~/lib/billing'

interface Product {
  id: 'pack_s' | 'pack_m' | 'pack_l' | 'pro' | 'team'
  kind: 'pack' | 'subscription'
  credits: number
  price: string
  plan: PlanId | null
  validMonths: number
  available: boolean
}

interface HistoryRow {
  id: number
  kind: 'grant' | 'revoke' | 'reserve' | 'release'
  amount: number
  note: string | null
  designDocId: number | null
  createdAt: string | null
}

interface BillingProps {
  plan: PlanId
  balance: number
  enforced: boolean
  limits: PlanLimits
  nextExpiry: { amount: number; expiresAt: string } | null
  boardsUsed: number
  subscription: {
    plan: PlanId
    status: string
    renewsAt: string | null
    endsAt: string | null
  } | null
  checkoutReady: boolean
  hasPurchases: boolean
  justPurchased: boolean
  costs: { perMaterial: number; compose: number; proMultiplier: number }
  freeCredits: { signup: number; monthly: number }
  plans: Record<PlanId, PlanLimits>
  products: Product[]
  history: HistoryRow[]
  referral: { url: string; invited: number; earned: number; reward: number; max: number }
}

function perCredit(price: string, credits: number): string {
  const n = Number.parseFloat(price.replace(/[^0-9.]/g, ''))
  const currency = price.replace(/[0-9.,\s]/g, '') || '$'
  return Number.isFinite(n) && credits > 0 ? `${currency}${(n / credits).toFixed(3)}` : price
}

function BuyButton({
  product,
  label,
  primary,
}: {
  product: Product
  label: string
  primary?: boolean
}) {
  const { t } = useT()
  if (!product.available) {
    return (
      <button type="button" className="btn btn--block" disabled>
        {t('billing.soon')}
      </button>
    )
  }
  return (
    <Form route="billing.checkout" method="post">
      {({ processing }: { processing: boolean }) => (
        <>
          <input type="hidden" name="product" value={product.id} />
          <button
            type="submit"
            className={`btn btn--block${primary ? ' btn--primary' : ''}`}
            disabled={processing}
            data-testid={`buy-${product.id}`}
          >
            {processing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
            {label}
          </button>
        </>
      )}
    </Form>
  )
}

export default function Billing({ billing }: { billing: BillingProps }) {
  const { t, tp } = useT()
  const b = billing
  const packs = b.products.filter((p) => p.kind === 'pack')
  const pro = b.products.find((p) => p.id === 'pro')!
  const team = b.products.find((p) => p.id === 'team')!
  const boardsLimit = b.limits.boards

  const historyLabel = (row: HistoryRow) => {
    if (row.kind === 'grant') {
      const key = `billing.source.${row.note}` as MessageKey
      return t('billing.history.grant', { what: t(key) === key ? (row.note ?? '') : t(key) })
    }
    return t(`billing.history.${row.kind}` as MessageKey)
  }

  const planCols: { id: PlanId; price: string; credits: string }[] = [
    {
      id: 'free',
      price: '$0',
      credits: t('billing.plans.freeCredits', b.freeCredits),
    },
    {
      id: 'payg',
      price: t('billing.plans.from', { price: packs[0]?.price ?? '' }),
      credits: t('billing.plans.packs'),
    },
    {
      id: 'pro',
      price: `${pro.price}${t('billing.plans.perMonth')}`,
      credits: t('billing.plans.monthlyCredits', { n: pro.credits }),
    },
    {
      id: 'team',
      price: `${team.price}${t('billing.plans.perMonth')}`,
      credits: t('billing.plans.monthlyCredits', { n: team.credits }),
    },
  ]
  const yes = <Check size={16} className="plan-table__yes" />
  const no = <span className="plan-table__no">—</span>
  const rows: { label: string; cell: (l: PlanLimits, id: PlanId) => React.ReactNode }[] = [
    {
      label: t('billing.feature.credits'),
      cell: (_l, id) => planCols.find((c) => c.id === id)!.credits,
    },
    {
      label: t('billing.feature.boards'),
      cell: (l) => (l.boards == null ? t('billing.unlimited') : l.boards),
    },
    {
      label: t('billing.feature.materials'),
      cell: (l) => l.materialsPerBoard ?? t('billing.unlimited'),
    },
    {
      label: t('billing.feature.history'),
      cell: (l) =>
        l.versionsKept == null
          ? t('billing.feature.historyAll')
          : t('billing.feature.historyLast', { n: l.versionsKept }),
    },
    { label: t('billing.feature.watermark'), cell: (l) => (l.watermark ? no : yes) },
    { label: t('billing.feature.exports'), cell: (l) => (l.exports ? yes : no) },
    { label: t('billing.feature.pro'), cell: (l) => (l.proReasoning ? yes : no) },
    { label: t('billing.feature.team'), cell: (_l, id) => (id === 'team' ? yes : no) },
  ]

  return (
    <div className="page billing" style={{ maxWidth: 1040 }}>
      <Head title={t('billing.headTitle')} />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">{t('billing.title')}</h1>
          <p className="t-muted">{t('billing.subtitle')}</p>
        </div>
      </header>

      {b.justPurchased ? (
        <div
          className="alert alert--notice billing__thanks"
          role="status"
          data-testid="billing-thanks"
        >
          <Sparkles />
          <span style={{ flex: 1 }}>{t('billing.thanks')}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => router.reload({ only: ['billing'] })}
          >
            <RefreshCw />
            {t('billing.refresh')}
          </button>
        </div>
      ) : null}

      {/* Podsumowanie */}
      <div className="billing__summary">
        <section className="card billing-stat" data-testid="billing-plan">
          <span className="billing-stat__label">{t('billing.planCard')}</span>
          <span className="billing-stat__value">{t(`plan.${b.plan}` as MessageKey)}</span>
          {b.subscription ? (
            <span className="t-small t-muted">
              {b.subscription.status === 'past_due'
                ? t('billing.pastDue')
                : b.subscription.status === 'cancelled' && b.subscription.endsAt
                  ? t('billing.endsOn', { date: formatDateTime(b.subscription.endsAt) })
                  : b.subscription.renewsAt
                    ? t('billing.renews', { date: formatDateTime(b.subscription.renewsAt) })
                    : null}
            </span>
          ) : null}
          {b.subscription || b.hasPurchases ? (
            <a
              className="btn btn--sm billing-stat__action"
              href="/billing/portal"
              data-testid="billing-portal"
            >
              <ExternalLink />
              {b.subscription ? t('billing.manage') : t('billing.invoices')}
            </a>
          ) : null}
        </section>

        <section className="card billing-stat" data-testid="billing-balance">
          <span className="billing-stat__label">{t('billing.balanceCard')}</span>
          <span className="billing-stat__value">
            <Coins className="billing-stat__icon" />
            {tp('count.credits', b.balance)}
          </span>
          <span className="t-small t-muted">
            {b.nextExpiry
              ? t('billing.expires', {
                  amount: tp('count.credits', b.nextExpiry.amount),
                  date: formatDateTime(b.nextExpiry.expiresAt),
                })
              : t('billing.noExpiry')}
          </span>
        </section>

        <section className="card billing-stat">
          <span className="billing-stat__label">{t('billing.usageCard')}</span>
          <span className="billing-stat__value">
            {b.boardsUsed}
            <span className="billing-stat__of">
              {' / '}
              {boardsLimit == null ? '∞' : boardsLimit}
            </span>
          </span>
          <span className="t-small t-muted">
            {t('billing.boards')} · {t('billing.materialsPerBoard')}:{' '}
            {b.limits.materialsPerBoard ?? t('billing.unlimited')}
          </span>
          {boardsLimit != null ? (
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.min(100, (b.boardsUsed / boardsLimit) * 100)}%` }} />
            </div>
          ) : null}
        </section>
      </div>

      {/* Pakiety */}
      <section className="billing__block">
        <div className="billing__head">
          <h2 className="t-title">{t('billing.packs.title')}</h2>
          <p className="t-muted t-small">{t('billing.packs.desc')}</p>
        </div>
        {!b.checkoutReady ? (
          <div className="alert alert--notice" style={{ marginBottom: 16 }}>
            <CreditCard />
            {t('billing.checkoutOff')}
          </div>
        ) : null}
        <div className="packs">
          {packs.map((p, i) => (
            <article
              key={p.id}
              className={`card card--outlined pack${i === 1 ? ' pack--featured' : ''}`}
              data-testid={`pack-${p.id}`}
            >
              <span className="pack__credits">
                <Coins />
                {p.credits}
              </span>
              <span className="pack__price">{p.price}</span>
              <span className="t-small t-muted">
                {t('billing.perCredit', { price: perCredit(p.price, p.credits) })}
              </span>
              <BuyButton product={p} label={t('billing.buy')} primary={i === 1} />
            </article>
          ))}
        </div>
      </section>

      {/* Plany */}
      <section className="billing__block">
        <div className="billing__head">
          <h2 className="t-title">{t('billing.plans.title')}</h2>
          <p className="t-muted t-small">{t('billing.plans.desc')}</p>
        </div>
        <div className="card card--outlined plan-table-wrap">
          <table className="plan-table" data-testid="plan-table">
            <thead>
              <tr>
                <th />
                {planCols.map((c) => (
                  <th key={c.id} aria-current={c.id === b.plan ? 'true' : undefined}>
                    <span className="plan-table__name">{t(`plan.${c.id}` as MessageKey)}</span>
                    <span className="plan-table__price">{c.price}</span>
                    {c.id === b.plan ? (
                      <span className="badge badge--accent">{t('billing.current')}</span>
                    ) : c.id === 'team' ? (
                      <span className="badge">{t('billing.soon')}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {planCols.map((c) => (
                    <td key={c.id} aria-current={c.id === b.plan ? 'true' : undefined}>
                      {row.cell(b.plans[c.id], c.id)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" />
                <td />
                <td>
                  <a
                    className="btn btn--sm btn--block"
                    href="#packs"
                    onClick={(e) => {
                      e.preventDefault()
                      document
                        .querySelector('.packs')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  >
                    {t('billing.topUp')}
                  </a>
                </td>
                <td>
                  {b.plan === 'pro' ? null : (
                    <BuyButton product={pro} label={t('billing.subscribe')} primary />
                  )}
                </td>
                <td>
                  <button type="button" className="btn btn--sm btn--block" disabled>
                    <Lock />
                    {t('billing.soon')}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="t-small t-faint" style={{ marginTop: 10 }}>
          {t('billing.plans.rollover')} · {t('billing.merchant')}
        </p>
      </section>

      {/* Polecenia */}
      <section className="card referral" data-testid="billing-referral">
        <div className="referral__icon">
          <Gift />
        </div>
        <div className="referral__body">
          <h2 className="t-body-lg" style={{ fontWeight: 500 }}>
            {t('billing.referral.title', { n: b.referral.reward })}
          </h2>
          <p className="t-small t-muted">{t('billing.referral.desc', { n: b.referral.reward })}</p>
          <div className="referral__link">
            <input
              className="input"
              readOnly
              value={b.referral.url}
              aria-label={t('billing.referral.linkLabel')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn"
              data-testid="copy-referral"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(b.referral.url)
                  toast.success(t('billing.referral.copied'))
                } catch {
                  toast.error(t('doc.copyFailed'))
                }
              }}
            >
              <Copy />
              {t('common.copy')}
            </button>
          </div>
          <span className="t-small t-faint">
            {t('billing.referral.stats', {
              invited: b.referral.invited,
              earned: tp('count.credits', b.referral.earned),
            })}
          </span>
        </div>
      </section>

      <div className="billing__split">
        {/* Koszty */}
        <section className="card billing__costs">
          <h2 className="t-body-lg" style={{ fontWeight: 500 }}>
            {t('billing.costs.title')}
          </h2>
          <dl className="cost-list">
            <div>
              <dt>{t('billing.costs.material')}</dt>
              <dd>{tp('count.credits', b.costs.perMaterial)}</dd>
            </div>
            <div>
              <dt>{t('billing.costs.compose')}</dt>
              <dd>{tp('count.credits', b.costs.compose)}</dd>
            </div>
            <div>
              <dt>{t('billing.costs.pro')}</dt>
              <dd>×{b.costs.proMultiplier}</dd>
            </div>
            <div>
              <dt>{t('billing.costs.cached')}</dt>
              <dd className="cost-list__free">{t('billing.costs.free')}</dd>
            </div>
            <div>
              <dt>{t('billing.costs.unchanged')}</dt>
              <dd className="cost-list__free">{t('billing.costs.free')}</dd>
            </div>
            <div>
              <dt>{t('billing.costs.failed')}</dt>
              <dd className="cost-list__free">{t('billing.costs.refund')}</dd>
            </div>
          </dl>
        </section>

        {/* Historia */}
        <section className="card billing__history" data-testid="billing-history">
          <h2 className="t-body-lg" style={{ fontWeight: 500 }}>
            {t('billing.history.title')}
          </h2>
          {b.history.length === 0 ? (
            <p className="t-muted t-small">{t('billing.history.empty')}</p>
          ) : (
            <ul className="history">
              {b.history.map((row) => (
                <li key={row.id}>
                  <span className="history__what">
                    {historyLabel(row)}
                    <span className="t-faint t-small" title={formatDateTime(row.createdAt)}>
                      {relativeTime(row.createdAt)}
                    </span>
                  </span>
                  <span
                    className={`history__amount${row.amount > 0 ? ' history__amount--plus' : ''}`}
                  >
                    {row.amount > 0 ? '+' : '−'}
                    {Math.abs(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            route="boards.index"
            className="t-small"
            style={{ color: 'var(--color-deep-teal)' }}
          >
            {t('nav.boards')} →
          </Link>
        </section>
      </div>
    </div>
  )
}
