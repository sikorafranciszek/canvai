/**
 * Okno podglądu UI: strona zbudowana z DESIGN.md w iframe z piaskownicą
 * (bez skryptów), przełącznik szerokości urządzenia, otwarcie w nowej karcie,
 * pobranie HTML i ponowna generacja.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Coins,
  Download,
  ExternalLink,
  Monitor,
  RefreshCw,
  Smartphone,
  Sparkles,
  Tablet,
  X,
} from 'lucide-react'
import { usePreviewStore } from '~/lib/board/preview'
import { useCanEdit } from '~/lib/board/session'
import { useT } from '~/i18n'

const DEVICES = [
  { id: 'desktop', width: 1280, icon: Monitor },
  { id: 'tablet', width: 820, icon: Tablet },
  { id: 'mobile', width: 390, icon: Smartphone },
] as const

export function PreviewDialog() {
  const { t, tp } = useT()
  const open = usePreviewStore((s) => s.open)
  const version = usePreviewStore((s) => s.version)
  const preview = usePreviewStore((s) => s.preview)
  const cost = usePreviewStore((s) => s.cost)
  const hasSpec = usePreviewStore((s) => s.hasSpec)
  const loading = usePreviewStore((s) => s.loading)
  const starting = usePreviewStore((s) => s.starting)
  const close = usePreviewStore((s) => s.close)
  const generate = usePreviewStore((s) => s.generate)
  const canEdit = useCanEdit()

  const [device, setDevice] = useState<(typeof DEVICES)[number]['id']>('desktop')
  const ref = useRef<HTMLDialogElement>(null)
  const pending = preview?.status === 'queued' || preview?.status === 'running'
  const width = DEVICES.find((d) => d.id === device)!.width
  const costLabel = cost > 0 ? tp('count.credits', cost) : null

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="preview-modal"
      data-testid="preview-dialog"
      aria-label={t('preview.title', { version: version ?? '' })}
      onClose={close}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      {open ? (
        <>
          <div className="preview-modal__bar">
            <div className="preview-modal__title">
              <Sparkles size={16} />
              {t('preview.title', { version: version ?? '' })}
            </div>
            {preview?.status === 'ready' ? (
              <div className="segmented" role="group" aria-label={t('preview.device')}>
                {DEVICES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={device === d.id}
                    onClick={() => setDevice(d.id)}
                    aria-label={t(`preview.device.${d.id}`)}
                    data-tip={t(`preview.device.${d.id}`)}
                  >
                    <d.icon size={15} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="preview-modal__actions">
              {preview?.status === 'ready' && preview.url ? (
                <>
                  <a
                    className="btn btn--sm"
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink />
                    {t('preview.openTab')}
                  </a>
                  <a
                    className="btn btn--sm btn--icon"
                    href={`${preview.url}?download=1`}
                    aria-label={t('preview.download')}
                    data-tip={t('preview.download')}
                  >
                    <Download />
                  </a>
                  <button
                    type="button"
                    className="btn btn--sm"
                    hidden={!canEdit}
                    onClick={() => void generate(true)}
                    disabled={starting}
                    data-testid="preview-regenerate"
                  >
                    <RefreshCw />
                    {t('preview.regenerate')}
                    {costLabel ? <span className="t-faint">· {costLabel}</span> : null}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn--quiet btn--icon btn--sm"
                onClick={close}
                aria-label={t('common.close')}
              >
                <X />
              </button>
            </div>
          </div>

          <div className="preview-modal__stage" data-clarity-mask="true">
            {loading ? (
              <div className="preview-modal__center">
                <span className="spinner" />
              </div>
            ) : preview?.status === 'ready' && preview.url ? (
              <div className="preview-frame" style={{ width: Math.min(width, 100_000) }}>
                <iframe
                  key={preview.id}
                  title={t('preview.title', { version: version ?? '' })}
                  src={preview.url}
                  sandbox=""
                  loading="lazy"
                  data-testid="preview-iframe"
                />
              </div>
            ) : pending ? (
              <div className="preview-modal__center" data-testid="preview-pending">
                <span className="spinner" />
                <strong>{t('preview.building')}</strong>
                <span className="t-muted t-small">{t('preview.buildingHint')}</span>
              </div>
            ) : (
              <div className="preview-modal__center preview-empty" data-testid="preview-empty">
                {preview?.status === 'failed' ? (
                  <div className="alert alert--danger" role="alert" style={{ maxWidth: 520 }}>
                    <AlertCircle />
                    {preview.error ?? t('preview.failed')}
                  </div>
                ) : null}
                <div className="empty-state__icon">
                  <Sparkles />
                </div>
                <strong style={{ fontSize: 18 }}>{t('preview.emptyTitle')}</strong>
                <p className="t-muted" style={{ maxWidth: 460, textAlign: 'center' }}>
                  {!canEdit
                    ? t('preview.viewerOnly')
                    : hasSpec
                      ? t('preview.emptyBody')
                      : t('preview.needsSpec')}
                </p>
                <button
                  hidden={!canEdit}
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void generate(preview?.status === 'failed')}
                  disabled={starting || !hasSpec}
                  data-testid="preview-generate"
                >
                  {starting ? (
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                  ) : (
                    <Sparkles />
                  )}
                  {t('preview.generate')}
                  {costLabel ? (
                    <span className="gen-cost">
                      <Coins />
                      {cost}
                    </span>
                  ) : null}
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </dialog>
  )
}
