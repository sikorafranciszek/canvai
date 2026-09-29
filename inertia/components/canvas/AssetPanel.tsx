/**
 * Panel boczny assetów tablicy — miniatury, nazwa, typ, rozmiar, notatka
 * użytkownika („co to jest”) i usuwanie. Klik w wiersz wyśrodkowuje i
 * zaznacza element na płótnie.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { useBoardStore } from '~/lib/board/session'
import { assetKindLabel, formatBytes } from '@shared/asset-utils'
import type { AssetDto } from '~/lib/board/api'

export function AssetPanel() {
  const assets = useBoardStore((s) => s.assets)
  const loading = useBoardStore((s) => s.assetsLoading)
  const initialized = useBoardStore((s) => s.initialized)

  return (
    <div
      data-testid="asset-panel"
      style={{
        flex: 1,
        minHeight: 0,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e2e8f0',
          fontSize: 13,
          fontWeight: 600,
          color: '#0f172a',
        }}
      >
        Assety <span style={{ color: '#94a3b8', fontWeight: 400 }}>({assets.length})</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!initialized || loading ? (
          <div
            style={{ padding: 16, color: '#64748b', fontSize: 13 }}
            data-testid="asset-panel-loading"
          >
            Ładowanie assetów…
          </div>
        ) : assets.length === 0 ? (
          <div
            style={{ padding: 16, color: '#64748b', fontSize: 13 }}
            data-testid="asset-panel-empty"
          >
            Brak assetów. Wklej zrzut ekranu (Ctrl+V) albo upuść pliki na płótno.
          </div>
        ) : (
          assets.map((asset) => <AssetRow key={asset.id} asset={asset} />)
        )}
      </div>
    </div>
  )
}

const AssetRow = memo(function AssetRow({ asset }: { asset: AssetDto }) {
  const centerOnAsset = useBoardStore((s) => s.centerOnAsset)
  const deleteAsset = useBoardStore((s) => s.deleteAsset)
  const updateNote = useBoardStore((s) => s.updateNote)

  const [note, setNote] = useState(asset.userNote ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const noteDirty = useRef(false)

  // Synchronizuj lokalny stan notatki, gdy asset się zmieni (np. po odświeżeniu).
  useEffect(() => {
    if (!noteDirty.current) setNote(asset.userNote ?? '')
  }, [asset.userNote])

  const commitNote = async () => {
    if (!noteDirty.current) return
    noteDirty.current = false
    setSavingNote(true)
    try {
      await updateNote(asset.id, note)
    } finally {
      setSavingNote(false)
    }
  }

  const title = asset.linkMeta?.title || asset.filename
  const subtitle =
    asset.kind === 'link'
      ? asset.filename
      : `${assetKindLabel(asset.kind)} · ${formatBytes(asset.size)}`

  return (
    <div
      data-testid={`asset-item-${asset.id}`}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid #f1f5f9',
        alignItems: 'flex-start',
      }}
    >
      <button
        type="button"
        data-testid={`asset-thumb-${asset.id}`}
        onClick={() => centerOnAsset(asset.id)}
        title="Wyśrodkuj na płótnie"
        style={{
          width: 56,
          height: 56,
          flexShrink: 0,
          borderRadius: 6,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          overflow: 'hidden',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AssetThumb asset={asset} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => centerOnAsset(asset.id)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            fontSize: 12,
            fontWeight: 600,
            color: '#0f172a',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={title}
        >
          {title}
        </button>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{subtitle}</div>

        <textarea
          data-testid={`asset-note-${asset.id}`}
          value={note}
          onChange={(e) => {
            noteDirty.current = true
            setNote(e.target.value)
          }}
          onBlur={commitNote}
          placeholder="Co to jest? (notatka dla AI)"
          rows={2}
          style={{
            marginTop: 6,
            width: '100%',
            fontSize: 12,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '6px 8px',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 10, color: '#cbd5e1' }}>{savingNote ? 'zapisywanie…' : ''}</span>
          <button
            type="button"
            data-testid={`asset-delete-${asset.id}`}
            onClick={() => deleteAsset(asset.id)}
            title="Usuń asset"
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            Usuń
          </button>
        </div>
      </div>
    </div>
  )
})

function AssetThumb({ asset }: { asset: AssetDto }) {
  if (asset.kind === 'link') {
    return <span style={{ fontSize: 20 }}>🔗</span>
  }
  if (asset.urls.thumb) {
    return (
      <img
        src={asset.urls.thumb}
        alt={asset.filename}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        loading="lazy"
      />
    )
  }
  if (asset.kind === 'pdf') {
    return <span style={{ fontSize: 20 }}>📄</span>
  }
  return <span style={{ fontSize: 20 }}>📎</span>
}
