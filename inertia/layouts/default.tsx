import { type Data } from '@generated/data'
import { toast, Toaster } from 'sonner'
import { usePage } from '@inertiajs/react'
import { type ReactElement, type ReactNode, useEffect } from 'react'
import { Form, Link } from '@adonisjs/inertia/react'
import { Coins, CreditCard, LayoutGrid, LogOut, Palette, Plus, Settings } from 'lucide-react'
import { useBillingStore } from '~/lib/billing'
import { ConsentBanner, LegalLinks } from '~/components/ui/ConsentBanner'
import { CrmLayout } from '~/components/crm/CrmLayout'
import { Brand } from '~/components/ui/Brand'
import { CreateBoardDialog } from '~/components/boards/CreateBoardDialog'
import { useUiStore } from '~/lib/ui'
import { translateFlash } from '~/lib/format'
import { LanguageSwitcher } from '~/components/ui/LanguageSwitcher'
import { ensureLocale, useLocaleStore, useT } from '~/i18n'
import { isLocale } from '@shared/i18n'

type SharedUser = { id: number; fullName: string | null; email: string; initials: string }

/**
 * Layout wybierany wg strony:
 * - `auth/*` — wyśrodkowana karta,
 * - `boards/show` i `errors/*` — pełny ekran (edytor ma własny pasek),
 * - pozostałe — shell z lewym paskiem nawigacji.
 */
export default function Layout({ children }: { children: ReactElement<Data.SharedProps> }) {
  const { url, flash, component } = usePage()
  const user = (children.props as { user?: SharedUser }).user
  const serverLocale = (children.props as { locale?: string }).locale
  const clarityId = (children.props as { clarityId?: string | null }).clarityId ?? null

  // Język z serwera (cookie / Accept-Language) jest źródłem prawdy przy wejściu na stronę.
  useEffect(() => {
    if (!isLocale(serverLocale)) return
    // Nawigacja Inertii nie przeładowuje dokumentu — `lang` aktualizujemy ręcznie.
    document.documentElement.lang = serverLocale
    if (useLocaleStore.getState().locale !== serverLocale) {
      void ensureLocale(serverLocale).then(() => useLocaleStore.setState({ locale: serverLocale }))
    }
  }, [serverLocale])

  useEffect(() => {
    toast.dismiss()
  }, [url])

  useEffect(() => {
    // Na stronach auth komunikaty pokazuje formularz (FlashAlert), nie toast.
    if (component.startsWith('auth/') || component.startsWith('crm/')) return
    if (flash.error) toast.error(translateFlash(flash.error))
    if (flash.success) toast.success(translateFlash(flash.success))
  })

  let content: ReactNode
  if (component === 'crm/login') {
    content = children
  } else if (component.startsWith('crm/')) {
    content = <CrmLayout>{children}</CrmLayout>
  } else if (component.startsWith('auth/')) {
    content = (
      <div className="auth">
        <div className="auth__topbar">
          <LanguageSwitcher />
        </div>
        <div className="auth__inner">
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Brand />
          </div>
          {children}
          <LegalLinks className="legal-links--center" />
        </div>
      </div>
    )
  } else if (
    component === 'boards/show' ||
    component.startsWith('errors/') ||
    component.startsWith('portal/') ||
    component.startsWith('print/') ||
    component.startsWith('email/') ||
    !user
  ) {
    content = children
  } else {
    content = (
      <AppShell user={user} component={component}>
        {children}
      </AppShell>
    )
  }

  return (
    <>
      {content}
      {component.startsWith('crm/') ? null : <ConsentBanner projectId={clarityId} />}
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--color-soft-paper)',
            color: 'var(--color-ink)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-subtle)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          },
        }}
      />
    </>
  )
}

function AppShell({
  user,
  component,
  children,
}: {
  user: SharedUser
  component: string
  children: ReactNode
}) {
  const openCreateBoard = useUiStore((s) => s.openCreateBoard)
  const { t, tp } = useT()
  const onBoards = component === 'boards/index'
  const billing = useBillingStore((s) => s.summary)

  // Saldo odświeżane przy każdej zmianie strony (zakup, generacja).
  useEffect(() => {
    void useBillingStore.getState().load()
  }, [component])

  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t('nav.main')}>
        <Link route="boards.index" aria-label={t('nav.home')}>
          <Brand />
        </Link>

        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={openCreateBoard}
          data-testid="sidebar-new-board"
        >
          <Plus />
          {t('nav.newBoard')}
        </button>

        <nav className="nav">
          <div className="nav__label">{t('nav.workspace')}</div>
          <Link
            route="boards.index"
            className="nav__item"
            aria-current={onBoards ? 'page' : undefined}
          >
            <LayoutGrid />
            {t('nav.boards')}
          </Link>
          <Link
            route="brandKits.page"
            className="nav__item"
            aria-current={component === 'brand_kits/index' ? 'page' : undefined}
            data-testid="nav-brand-kits"
          >
            <Palette />
            {t('nav.brandKits')}
          </Link>
          <Link
            route="billing.show"
            className="nav__item"
            aria-current={component === 'billing/index' ? 'page' : undefined}
            data-testid="nav-billing"
          >
            <CreditCard />
            {t('nav.billing')}
          </Link>
          <Link
            route="settings.show"
            className="nav__item"
            aria-current={component === 'settings/index' ? 'page' : undefined}
            data-testid="nav-settings"
          >
            <Settings />
            {t('nav.settings')}
          </Link>
        </nav>

        <div className="sidebar__footer">
          {billing?.enforced ? (
            <Link route="billing.show" className="credits-pill" data-testid="credits-pill">
              <Coins />
              <span>{tp('count.credits', billing.balance)}</span>
              <span className="credits-pill__plan">{t(`plan.short.${billing.plan}`)}</span>
            </Link>
          ) : null}
          <div style={{ padding: '0 8px' }}>
            <LanguageSwitcher />
          </div>
          <LegalLinks className="legal-links--sidebar" />
          <div className="user-chip">
            <span className="avatar" aria-hidden>
              {user.initials}
            </span>
            <div className="user-chip__text">
              <span className="t-truncate" style={{ fontSize: 13, fontWeight: 500 }}>
                {user.fullName || user.email.split('@')[0]}
              </span>
              <span className="t-truncate t-small t-faint">{user.email}</span>
            </div>
            <Form route="session.destroy" style={{ marginLeft: 'auto' }}>
              <button
                type="submit"
                className="btn btn--quiet btn--icon btn--sm"
                aria-label={t('nav.logout')}
                data-tip={t('nav.logout')}
                data-tip-side="top"
              >
                <LogOut />
              </button>
            </Form>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="mobile-bar">
          <Link route="boards.index">
            <Brand />
          </Link>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Link
              route="brandKits.page"
              className="btn btn--quiet btn--icon btn--sm"
              aria-label={t('nav.brandKits')}
              data-testid="mobile-nav-brand-kits"
            >
              <Palette />
            </Link>
            <Link
              route="billing.show"
              className="btn btn--quiet btn--icon btn--sm"
              aria-label={t('nav.billing')}
              data-testid="mobile-nav-billing"
            >
              <CreditCard />
            </Link>
            <Link
              route="settings.show"
              className="btn btn--quiet btn--icon btn--sm"
              aria-label={t('nav.settings')}
              data-testid="mobile-nav-settings"
            >
              <Settings />
            </Link>
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreateBoard}>
              <Plus />
              {t('nav.newShort')}
            </button>
            <Form route="session.destroy">
              <button type="submit" className="btn btn--icon btn--sm" aria-label={t('nav.logout')}>
                <LogOut />
              </button>
            </Form>
          </div>
        </div>
        <main>{children}</main>
      </div>

      <CreateBoardDialog />
    </div>
  )
}
