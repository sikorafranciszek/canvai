import { Head, Link, router } from '@inertiajs/react'
import { Copy, Lock, Palette, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { brandKitNote, deleteBrandKit, renameBrandKit, type BrandKitDto } from '~/lib/brand_kits'
import { useT } from '~/i18n'

export default function BrandKits({
  kits: initial,
  allowed,
}: {
  kits: BrandKitDto[]
  allowed: boolean
}) {
  const { t } = useT()
  const [kits, setKits] = useState(initial)

  return (
    <div className="page" style={{ maxWidth: 1040 }}>
      <Head title={t('brandKits.title')} />
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="t-display">{t('brandKits.title')}</h1>
          <p className="t-muted">{t('brandKits.subtitle')}</p>
        </div>
      </header>

      {!allowed ? (
        <div className="alert alert--notice">
          <Lock />
          <span style={{ flex: 1 }}>{t('brandKits.lockedBody')}</span>
          <Link href="/billing" className="btn btn--sm btn--primary">
            {t('billing.upgrade')}
          </Link>
        </div>
      ) : null}

      {kits.length === 0 ? (
        <div className="card empty-state" data-testid="brand-kits-empty">
          <div className="empty-state__icon">
            <Palette />
          </div>
          <strong>{t('brandKits.emptyTitle')}</strong>
          <p className="t-muted" style={{ maxWidth: 460 }}>
            {t('brandKits.emptyBody')}
          </p>
        </div>
      ) : (
        <div className="kits">
          {kits.map((kit) => (
            <article key={kit.id} className="card kit" data-testid={`brand-kit-${kit.id}`}>
              <div className="kit__swatches" aria-hidden>
                {kit.colors.slice(0, 8).map((c) => (
                  <span
                    key={c.hex + c.name}
                    style={{ background: c.hex }}
                    title={`${c.name} ${c.hex}`}
                  />
                ))}
              </div>
              <div className="kit__head">
                <h2 className="t-body-lg" style={{ fontWeight: 500 }}>
                  {kit.name}
                </h2>
                <div className="kit__actions">
                  <button
                    type="button"
                    className="btn btn--quiet btn--icon btn--sm"
                    aria-label={t('brandKits.copyNote')}
                    data-tip={t('brandKits.copyNote')}
                    onClick={async () => {
                      await navigator.clipboard.writeText(brandKitNote(kit)).catch(() => {})
                      toast.success(t('settings.api.copied'))
                    }}
                  >
                    <Copy />
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--icon btn--sm"
                    aria-label={t('brandKits.rename')}
                    data-tip={t('brandKits.rename')}
                    onClick={async () => {
                      const name = window.prompt(t('brandKits.rename'), kit.name)?.trim()
                      if (!name || name === kit.name) return
                      try {
                        const updated = await renameBrandKit(kit.id, name)
                        setKits((all) => all.map((k) => (k.id === kit.id ? updated : k)))
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : t('brandKits.failed'))
                      }
                    }}
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--icon btn--sm"
                    aria-label={t('brandKits.delete')}
                    data-tip={t('brandKits.delete')}
                    onClick={async () => {
                      if (!window.confirm(t('brandKits.deleteConfirm', { name: kit.name }))) return
                      await deleteBrandKit(kit.id).catch(() => {})
                      setKits((all) => all.filter((k) => k.id !== kit.id))
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>

              <dl className="kit__facts">
                <dt>{t('brandKits.colors')}</dt>
                <dd className="kit__colors">
                  {kit.colors.map((c) => (
                    <span key={c.hex + c.name} className="kit__color">
                      <i style={{ background: c.hex }} />
                      {c.name} <code>{c.hex}</code>
                    </span>
                  ))}
                </dd>
                {kit.fonts.length ? (
                  <>
                    <dt>{t('brandKits.fonts')}</dt>
                    <dd>{kit.fonts.map((f) => f.name).join(' · ')}</dd>
                  </>
                ) : null}
                {kit.rules.length ? (
                  <>
                    <dt>{t('brandKits.rules')}</dt>
                    <dd>
                      <ul className="kit__rules">
                        {kit.rules.slice(0, 5).map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                ) : null}
              </dl>

              {kit.sourceBoardId ? (
                <button
                  type="button"
                  className="t-small kit__source"
                  onClick={() => router.visit(`/boards/${kit.sourceBoardId}`)}
                >
                  {t('brandKits.source', { version: kit.sourceVersion ?? '' })} →
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
