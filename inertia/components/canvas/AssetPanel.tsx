/**
 * Panel assetów tablicy — miniatury, nazwa, typ, rozmiar, notatka użytkownika
 * („co to jest” — kontekst dla AI) i usuwanie z potwierdzeniem. Klik w
 * miniaturę lub nazwę wyśrodkowuje i zaznacza element na płótnie.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  File,
  FileText,
  ImagePlus,
  Inbox,
  Link2,
  Search,
  Trash2,
} from 'lucide-react'
import { useBoardStore, useCanEdit, useCanvasAssets } from '~/lib/board/session'
import { formatBytes } from '@shared/asset-utils'
import { shortcut } from '~/lib/keys'
import { useT, type MessageKey } from '~/i18n'
import { ASSET_ASPECTS, type AssetRole, type AssetUsage } from '@shared/asset-usage'
import type { AssetDto } from '~/lib/board/api'
import { Dialog } from '~/components/ui/Dialog'

export function AssetPanel() {
  const { t } = useT()
  // Tylko materiały obecne na płótnie (usunięty element znika też stąd).
  const assets = useCanvasAssets()
  const loading = useBoardStore((s) => s.assetsLoading)
  const canEdit = useCanEdit()
  const initialized = useBoardStore((s) => s.initialized)
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<AssetDto | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assets
    return assets.filter((a) =>
      [a.filename, a.userNote ?? '', a.linkMeta?.title ?? ''].some((v) =>
        v.toLowerCase().includes(q)
      )
    )
  }, [assets, query])

  const withoutNote = assets.filter((a) => !a.userNote?.trim()).length
  const allAssets = useBoardStore((s) => s.assets)
  const inbox = useMemo(() => allAssets.filter((a) => a.inbox), [allAssets])
  const placeInboxAssets = useBoardStore((s) => s.placeInboxAssets)

  return (
    <div
      data-testid="asset-panel"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {assets.length > 3 ? (
        <div className="panel-toolbar">
          <label className="input-group" style={{ flex: 1 }}>
            <span className="sr-only">{t('assets.filter')}</span>
            <Search />
            <input
              className="input input--sm"
              style={{ paddingLeft: 34 }}
              type="search"
              placeholder={t('assets.filterPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {assets.length > 0 && withoutNote > 0 ? (
        <div className="alert alert--notice" style={{ margin: '12px 16px 4px' }}>
          <FileText />
          <span>{t('assets.missingNotes', { n: withoutNote })}</span>
        </div>
      ) : null}

      <div className="panel-scroll">
        {canEdit && inbox.length > 0 ? (
          <div className="inbox" data-testid="asset-inbox">
            <div className="inbox__head">
              <Inbox size={15} />
              <span>{t('assets.inbox.title', { n: inbox.length })}</span>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                style={{ marginLeft: 'auto' }}
                onClick={() => void placeInboxAssets(inbox.map((a) => String(a.id)))}
                data-testid="inbox-place-all"
              >
                <ArrowDownToLine />
                {t('assets.inbox.placeAll')}
              </button>
            </div>
            {inbox.map((asset) => (
              <div key={asset.id} className="inbox__item">
                {asset.urls.thumb ? (
                  <img src={asset.urls.thumb} alt="" className="inbox__thumb" />
                ) : (
                  <span className="inbox__thumb inbox__thumb--icon">
                    {asset.kind === 'link' ? <Link2 size={16} /> : <File size={16} />}
                  </span>
                )}
                <div className="inbox__text">
                  <span className="t-truncate">{asset.linkMeta?.title || asset.filename}</span>
                  <span className="t-small t-faint t-truncate">
                    {t('assets.inbox.from', { name: asset.submittedBy ?? '—' })}
                    {asset.userNote ? ` · „${asset.userNote}”` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--quiet btn--icon btn--sm"
                  aria-label={t('assets.inbox.place')}
                  data-tip={t('assets.inbox.place')}
                  onClick={() => void placeInboxAssets([String(asset.id)])}
                >
                  <ArrowDownToLine />
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--icon btn--sm"
                  aria-label={t('common.delete')}
                  onClick={() => setDeleting(asset)}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {!initialized || loading ? (
          <div
            data-testid="asset-panel-loading"
            style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', gap: 12 }}>
                <div className="skeleton" style={{ width: 52, height: 52 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skeleton" style={{ height: 12, width: '70%' }} />
                  <div className="skeleton" style={{ height: 10, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="panel-empty" data-testid="asset-panel-empty">
            <div className="empty-state__icon">
              <ImagePlus />
            </div>
            <div style={{ color: 'var(--color-ink)', fontWeight: 500 }}>
              {t('assets.empty.title')}
            </div>
            <p>{t('assets.empty.body', { keys: shortcut('V') })}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel-empty">{t('assets.noMatch', { query })}</div>
        ) : (
          visible.map((asset) => (
            <AssetRow key={asset.id} asset={asset} onDelete={() => setDeleting(asset)} />
          ))
        )}
      </div>

      <DeleteAssetDialog asset={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

const AssetRow = memo(function AssetRow({
  asset,
  onDelete,
}: {
  asset: AssetDto
  onDelete: () => void
}) {
  const { t } = useT()
  const canEdit = useCanEdit()
  const centerOnAsset = useBoardStore((s) => s.centerOnAsset)
  const updateNote = useBoardStore((s) => s.updateNote)

  const [note, setNote] = useState(asset.userNote ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const noteDirty = useRef(false)

  // Synchronizuj lokalny stan notatki, gdy asset się zmieni (np. po odświeżeniu).
  useEffect(() => {
    if (!noteDirty.current) setNote(asset.userNote ?? '')
  }, [asset.userNote])

  const commitNote = async () => {
    if (!noteDirty.current) return
    noteDirty.current = false
    setSaveState('saving')
    try {
      await updateNote(asset.id, note)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1500)
    } catch {
      setSaveState('idle')
    }
  }

  const title = asset.linkMeta?.title || asset.filename
  const subtitle =
    asset.kind === 'link'
      ? safeHost(asset.filename)
      : [t(`assetKind.${asset.kind}`), formatBytes(asset.size), dims(asset)]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="asset-row" data-testid={`asset-item-${asset.id}`}>
      <button
        type="button"
        className="asset-thumb"
        data-testid={`asset-thumb-${asset.id}`}
        onClick={() => centerOnAsset(asset.id)}
        aria-label={t('assets.showOnCanvasNamed', { name: title })}
        title={t('assets.showOnCanvas')}
      >
        <AssetThumb asset={asset} />
      </button>

      <div className="asset-row__main">
        <div className="asset-row__head">
          <button
            type="button"
            className="asset-row__name t-truncate"
            onClick={() => centerOnAsset(asset.id)}
            style={{ textAlign: 'left' }}
            title={title}
          >
            {title}
          </button>
          <span className="badge badge--outline" style={{ height: 18 }}>
            A{asset.id}
          </span>
          <div className="asset-row__actions" hidden={!canEdit}>
            <button
              type="button"
              className="btn btn--quiet btn--icon btn--sm"
              data-testid={`asset-delete-${asset.id}`}
              onClick={onDelete}
              aria-label={t('assets.deleteNamed', { name: title })}
              data-tip={t('common.delete')}
            >
              <Trash2 />
            </button>
          </div>
        </div>
        <div className="t-small t-faint t-truncate">{subtitle}</div>

        <label className="sr-only" htmlFor={`note-${asset.id}`}>
          {t('assets.noteLabel')}
        </label>
        <textarea
          id={`note-${asset.id}`}
          className="textarea note-input"
          data-testid={`asset-note-${asset.id}`}
          value={note}
          readOnly={!canEdit}
          maxLength={2000}
          onChange={(e) => {
            noteDirty.current = true
            setNote(e.target.value)
          }}
          onBlur={commitNote}
          placeholder={canEdit ? t('assets.notePlaceholder') : ''}
          rows={note.length > 60 ? 3 : 1}
        />
        <UsagePicker asset={asset} />
        {saveState !== 'idle' ? (
          <span
            className="t-caption t-faint"
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
          >
            {saveState === 'saving' ? (
              t('assets.saving')
            ) : (
              <>
                <Check size={11} /> {t('assets.saved')}
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  )
})

const ROLE_KEYS: Record<string, MessageKey> = {
  auto: 'usage.role.auto',
  own: 'usage.role.own',
  inspiration: 'usage.role.inspiration',
  avoid: 'usage.role.avoid',
}

/**
 * Co AI ma wziąć z materiału: rola (nasz / inspiracja / anty-wzór) i aspekty.
 * Np. zrzut „podoba mi się układ” → inspiracja + Układ: kolory z niego nie trafią do tokenów.
 */
function UsagePicker({ asset }: { asset: AssetDto }) {
  const { t } = useT()
  const updateUsage = useBoardStore((s) => s.updateUsage)
  const readOnly = useBoardStore((s) => s.readOnly)
  const usage = asset.usage ?? { role: null, aspects: [] }
  const role = usage.role ?? 'auto'
  const set = (next: Partial<AssetUsage>) => void updateUsage(asset.id, { ...usage, ...next })

  return (
    <div className="usage-picker" data-testid={`asset-usage-${asset.id}`}>
      <label className="usage-picker__role">
        <span className="sr-only">{t('usage.roleLabel')}</span>
        <select
          className={`select select--sm usage-picker__select usage-picker__select--${role}`}
          value={role}
          disabled={readOnly}
          data-testid={`asset-role-${asset.id}`}
          onChange={(e) =>
            set({
              role: e.target.value === 'auto' ? null : (e.target.value as AssetRole),
              aspects: e.target.value === 'avoid' ? [] : usage.aspects,
            })
          }
        >
          {(['auto', 'own', 'inspiration', 'avoid'] as const).map((r) => (
            <option key={r} value={r}>
              {t(ROLE_KEYS[r])}
            </option>
          ))}
        </select>
      </label>
      {role === 'avoid' ? (
        <span className="t-caption t-faint">{t('usage.avoidHint')}</span>
      ) : (
        <div className="usage-picker__aspects" role="group" aria-label={t('usage.aspectsLabel')}>
          <span className="t-caption t-faint">{t('usage.take')}</span>
          {ASSET_ASPECTS.map((a) => {
            const on = usage.aspects.includes(a)
            return (
              <button
                key={a}
                type="button"
                className="usage-chip"
                aria-pressed={on}
                disabled={readOnly}
                data-testid={`asset-aspect-${asset.id}-${a}`}
                onClick={() =>
                  set({
                    aspects: on ? usage.aspects.filter((x) => x !== a) : [...usage.aspects, a],
                  })
                }
              >
                {t(`usage.aspect.${a}` as MessageKey)}
              </button>
            )
          })}
          {usage.aspects.length === 0 ? (
            <span className="t-caption t-faint">{t('usage.all')}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function DeleteAssetDialog({ asset, onClose }: { asset: AssetDto | null; onClose: () => void }) {
  const { t } = useT()
  const deleteAsset = useBoardStore((s) => s.deleteAsset)
  const title = asset ? asset.linkMeta?.title || asset.filename : ''
  return (
    <Dialog
      open={Boolean(asset)}
      onClose={onClose}
      title={t('assets.delete.title')}
      testId="delete-asset-dialog"
      description={t('assets.delete.body', { name: title })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} autoFocus>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--danger-solid"
            data-testid="confirm-delete-asset"
            onClick={() => {
              if (asset) void deleteAsset(asset.id)
              onClose()
            }}
          >
            <Trash2 />
            {t('common.delete')}
          </button>
        </>
      }
    />
  )
}

function dims(asset: AssetDto): string {
  return asset.width && asset.height ? `${asset.width}×${asset.height}` : ''
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function AssetThumb({ asset }: { asset: AssetDto }) {
  if (asset.kind === 'link') return <Link2 />
  if (asset.urls.thumb) return <img src={asset.urls.thumb} alt="" loading="lazy" />
  if (asset.kind === 'pdf') return <FileText />
  return <File />
}
