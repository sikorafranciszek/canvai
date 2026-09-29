/**
 * Panel assetów tablicy — miniatury, nazwa, typ, rozmiar, notatka użytkownika
 * („co to jest” — kontekst dla AI) i usuwanie z potwierdzeniem. Klik w
 * miniaturę lub nazwę wyśrodkowuje i zaznacza element na płótnie.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, File, FileText, ImagePlus, Link2, Search, Trash2 } from 'lucide-react'
import { useBoardStore } from '~/lib/board/session'
import { assetKindLabel, formatBytes } from '@shared/asset-utils'
import type { AssetDto } from '~/lib/board/api'
import { Dialog } from '~/components/ui/Dialog'

export function AssetPanel() {
  const assets = useBoardStore((s) => s.assets)
  const loading = useBoardStore((s) => s.assetsLoading)
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

  return (
    <div
      data-testid="asset-panel"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {assets.length > 3 ? (
        <div className="panel-toolbar">
          <label className="input-group" style={{ flex: 1 }}>
            <span className="sr-only">Filtruj materiały</span>
            <Search />
            <input
              className="input input--sm"
              style={{ paddingLeft: 34 }}
              type="search"
              placeholder="Filtruj materiały…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {assets.length > 0 && withoutNote > 0 ? (
        <div className="alert alert--notice" style={{ margin: '12px 16px 4px' }}>
          <FileText />
          <span>
            Dodaj krótką notatkę do materiałów bez opisu ({withoutNote}) — AI lepiej zrozumie, co
            przedstawiają.
          </span>
        </div>
      ) : null}

      <div className="panel-scroll">
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
            <div style={{ color: 'var(--color-ink)', fontWeight: 500 }}>Brak materiałów</div>
            <p>
              Wklej zrzut ekranu (<span className="kbd">Ctrl</span> <span className="kbd">V</span>),
              przeciągnij pliki na płótno albo użyj przycisku „Wgraj”.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel-empty">Brak materiałów pasujących do „{query}”.</div>
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
      : [assetKindLabel(asset.kind), formatBytes(asset.size), dims(asset)]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="asset-row" data-testid={`asset-item-${asset.id}`}>
      <button
        type="button"
        className="asset-thumb"
        data-testid={`asset-thumb-${asset.id}`}
        onClick={() => centerOnAsset(asset.id)}
        aria-label={`Pokaż „${title}” na płótnie`}
        title="Pokaż na płótnie"
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
          <div className="asset-row__actions">
            <button
              type="button"
              className="btn btn--quiet btn--icon btn--sm"
              data-testid={`asset-delete-${asset.id}`}
              onClick={onDelete}
              aria-label={`Usuń „${title}”`}
              data-tip="Usuń"
            >
              <Trash2 />
            </button>
          </div>
        </div>
        <div className="t-small t-faint t-truncate">{subtitle}</div>

        <label className="sr-only" htmlFor={`note-${asset.id}`}>
          Notatka dla AI
        </label>
        <textarea
          id={`note-${asset.id}`}
          className="textarea note-input"
          data-testid={`asset-note-${asset.id}`}
          value={note}
          maxLength={2000}
          onChange={(e) => {
            noteDirty.current = true
            setNote(e.target.value)
          }}
          onBlur={commitNote}
          placeholder="Dodaj opis dla AI…"
          rows={note.length > 60 ? 3 : 1}
        />
        {saveState !== 'idle' ? (
          <span
            className="t-caption t-faint"
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
          >
            {saveState === 'saving' ? (
              'Zapisywanie…'
            ) : (
              <>
                <Check size={11} /> Zapisano
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  )
})

function DeleteAssetDialog({ asset, onClose }: { asset: AssetDto | null; onClose: () => void }) {
  const deleteAsset = useBoardStore((s) => s.deleteAsset)
  const title = asset ? asset.linkMeta?.title || asset.filename : ''
  return (
    <Dialog
      open={Boolean(asset)}
      onClose={onClose}
      title="Usunąć materiał?"
      testId="delete-asset-dialog"
      description={
        <>
          „{title}” zniknie z tablicy i z panelu. Kolejne wersje DESIGN.md nie będą go uwzględniać.
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} autoFocus>
            Anuluj
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
            Usuń
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
