/**
 * Układ panelu CRM: boczna nawigacja (pulpit, użytkownicy, analityka, logi),
 * zalogowany administrator, wylogowanie. Komunikaty flash po polsku.
 */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { usePage } from '@inertiajs/react'
import { toast } from 'sonner'
import { Activity, LayoutDashboard, LogOut, ScrollText, Users } from 'lucide-react'
import { Brand } from '~/components/ui/Brand'

export const CRM_FLASH: Record<string, string> = {
  'crm.login.invalid': 'Nieprawidłowy e-mail lub hasło.',
  'crm.login.denied': 'To konto nie ma dostępu do CRM.',
  'crm.login.rateLimited': 'Za dużo prób logowania. Spróbuj ponownie za kilkanaście minut.',
  'crm.flash.credits': 'Kredyty przyznane.',
  'crm.flash.verified': 'Adres e-mail oznaczony jako potwierdzony.',
  'crm.flash.disabled': 'Konto zablokowane — użytkownik został wylogowany.',
  'crm.flash.enabled': 'Konto odblokowane.',
  'crm.flash.selfDisable': 'Nie możesz zablokować własnego konta.',
  'crm.flash.selfDelete': 'Nie możesz usunąć własnego konta.',
  'crm.flash.resetSent': 'Wysłano link do ustawienia nowego hasła.',
  'crm.flash.mailFailed': 'Nie udało się wysłać wiadomości.',
  'crm.flash.confirmMismatch': 'Wpisany e-mail nie zgadza się z kontem — nic nie usunięto.',
  'crm.flash.deleted': 'Konto i jego dane zostały usunięte.',
}

const NAV = [
  { href: '/', label: 'Pulpit', icon: LayoutDashboard, match: 'crm/dashboard' },
  { href: '/users', label: 'Użytkownicy', icon: Users, match: 'crm/user' },
  { href: '/analytics', label: 'Analityka', icon: Activity, match: 'crm/analytics' },
  { href: '/logs', label: 'Logi', icon: ScrollText, match: 'crm/logs' },
]

export function CrmLayout({ children }: { children: ReactNode }) {
  const { component, flash, props } = usePage<{ user?: { email: string; initials: string } }>()
  const user = props.user

  useEffect(() => {
    if (flash?.error) toast.error(CRM_FLASH[flash.error as string] ?? String(flash.error))
    if (flash?.success) toast.success(CRM_FLASH[flash.success as string] ?? String(flash.success))
  }, [flash])

  return (
    <div className="shell crm">
      <aside className="sidebar crm__sidebar" aria-label="Nawigacja CRM">
        <Link href="/" className="crm__brand">
          <Brand />
          <span className="badge badge--accent">CRM</span>
        </Link>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav__item"
              aria-current={component.startsWith(item.match) ? 'page' : undefined}
            >
              <item.icon />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar__footer">
          {user ? (
            <div className="user-chip">
              <span className="avatar" aria-hidden>
                {user.initials}
              </span>
              <div className="user-chip__text">
                <span className="t-truncate" style={{ fontSize: 13, fontWeight: 500 }}>
                  Administrator
                </span>
                <span className="t-truncate t-small t-faint">{user.email}</span>
              </div>
              <Form route="crm.logout" style={{ marginLeft: 'auto' }}>
                <button
                  type="submit"
                  className="btn btn--quiet btn--icon btn--sm"
                  aria-label="Wyloguj"
                >
                  <LogOut />
                </button>
              </Form>
            </div>
          ) : null}
        </div>
      </aside>
      <div className="main">
        <main className="crm__main">{children}</main>
      </div>
    </div>
  )
}

/** Przełącznik zakresu czasu (linki — stan w adresie). */
export function RangeTabs({
  value,
  base,
  extra = {},
}: {
  value: string
  base: string
  extra?: Record<string, string>
}) {
  const ranges = [
    ['24h', '24 h'],
    ['7d', '7 dni'],
    ['30d', '30 dni'],
    ['90d', '90 dni'],
  ]
  return (
    <div className="segmented segmented--text" role="group" aria-label="Zakres czasu">
      {ranges.map(([key, label]) => {
        const qs = new URLSearchParams({ ...extra, range: key })
        return (
          <Link
            key={key}
            href={`${base}?${qs}`}
            aria-pressed={value === key}
            className="segmented__link"
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

export function NoAnalytics() {
  return (
    <div className="alert alert--notice" data-testid="crm-no-analytics">
      <Activity />
      <span>
        Baza analityczna (ClickHouse) jest niedostępna — dane o aktywności, żądaniach i logach
        pojawią się po ustawieniu <code>CLICKHOUSE_URL</code>. Dane kont i rozliczeń są aktualne.
      </span>
    </div>
  )
}
