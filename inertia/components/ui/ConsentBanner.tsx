/** Baner zgody na analitykę (Microsoft Clarity) — pokazywany, dopóki użytkownik nie zdecyduje. */
import { useEffect } from 'react'
import { loadClarity, privacyUrl, readConsent, useConsentStore } from '~/lib/consent'
import { useT } from '~/i18n'

export function ConsentBanner({ projectId }: { projectId: string | null }) {
  const { t } = useT()
  const open = useConsentStore((s) => s.open)
  const decide = useConsentStore((s) => s.decide)

  useEffect(() => {
    // Bez skonfigurowanego projektu (dev, self-hosting) nie ma analityki ani banera.
    if (!projectId) return
    const choice = readConsent()
    if (choice === 'granted') loadClarity(projectId)
    else if (!choice) useConsentStore.setState({ open: true })
  }, [projectId])

  if (!projectId || !open) return null
  return (
    <section
      className="consent"
      role="region"
      aria-label={t('consent.title')}
      data-testid="consent-banner"
    >
      <p className="consent__title">{t('consent.title')}</p>
      <p className="consent__text">
        {t('consent.text')}{' '}
        <a href={privacyUrl()} target="_blank" rel="noopener noreferrer">
          {t('consent.more')}
        </a>
      </p>
      <div className="consent__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => decide('denied', projectId)}
          data-testid="consent-reject"
        >
          {t('consent.reject')}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() => decide('granted', projectId)}
          data-testid="consent-accept"
        >
          {t('consent.accept')}
        </button>
      </div>
    </section>
  )
}

/** Linki „Prywatność · Cookies” do stopek aplikacji. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const { t } = useT()
  const show = useConsentStore((s) => s.show)
  return (
    <span className={`legal-links ${className}`}>
      <a href={privacyUrl()} target="_blank" rel="noopener noreferrer">
        {t('legal.privacy')}
      </a>
      <span aria-hidden>·</span>
      <button type="button" onClick={show}>
        {t('legal.cookies')}
      </button>
    </span>
  )
}
