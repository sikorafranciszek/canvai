import { Languages } from 'lucide-react'
import { LOCALE_LABELS, LOCALES } from '@shared/i18n'
import { useLocaleStore, useT } from '~/i18n'

/** Przełącznik PL/EN — zmienia język od razu i zapamiętuje go w cookie. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useT()
  const setLocale = useLocaleStore((s) => s.setLocale)

  return (
    <div
      className="lang-switch"
      role="group"
      aria-label={t('common.language')}
      data-testid="language-switcher"
    >
      {compact ? null : <Languages className="lang-switch__icon" aria-hidden />}
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="lang-switch__btn"
          aria-pressed={locale === l}
          title={LOCALE_LABELS[l]}
          data-testid={`lang-${l}`}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
