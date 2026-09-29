/**
 * Panel DESIGN.md: stan generacji z postępem, podgląd dokumentu, wybór
 * wersji, diff z poprzednią wersją, pobieranie i kopiowanie.
 */
import { useMemo, useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { diffLines, diffStats } from '@shared/line-diff'
import { designDocDownloadUrl, type DesignDocDto } from '~/lib/board/api'
import { progressLabel, progressRatio, useDesignStore } from '~/lib/board/design'
import { useBoardStore } from '~/lib/board/session'
import { MarkdownView } from '~/components/design/MarkdownView'

const btn: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

const STATUS_LABEL: Record<DesignDocDto['status'], string> = {
  queued: 'w kolejce',
  running: 'w toku',
  ready: 'gotowa',
  failed: 'błąd',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

export function DesignDocPanel() {
  const boardId = useDesignStore((s) => s.boardId)
  const versions = useDesignStore((s) => s.versions)
  const current = useDesignStore((s) => s.current)
  const previous = useDesignStore((s) => s.previous)
  const active = useDesignStore((s) => s.active)
  const loading = useDesignStore((s) => s.loading)
  const reusedNotice = useDesignStore((s) => s.reusedNotice)
  const selectVersion = useDesignStore((s) => s.selectVersion)
  const generate = useDesignStore((s) => s.generate)

  const assets = useBoardStore((s) => s.assets)
  const centerOnAsset = useBoardStore((s) => s.centerOnAsset)

  const [showDiff, setShowDiff] = useState(false)

  const assetLabel = (id: number) =>
    assets.find((a) => String(a.id) === String(id))?.filename ?? null

  const content = current?.status === 'ready' ? (current.contentMd ?? '') : ''
  const canDiff = Boolean(content && previous?.contentMd)

  const diff = useMemo(
    () => (showDiff && canDiff ? diffLines(previous!.contentMd!, content) : null),
    [showDiff, canDiff, previous, content]
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('Skopiowano DESIGN.md do schowka')
    } catch {
      toast.error('Nie udało się skopiować do schowka')
    }
  }

  return (
    <div
      data-testid="design-doc-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {active ? (
        <div
          data-testid="design-doc-status"
          data-status={active.status}
          style={{ padding: 12, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}
        >
          <div style={{ fontSize: 12, color: '#334155', marginBottom: 6 }}>
            Generowanie wersji {active.version}: {progressLabel(active)}
          </div>
          <div style={{ height: 6, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round(progressRatio(active) * 100)}%`,
                background: '#4f46e5',
                transition: 'width .4s ease',
              }}
            />
          </div>
        </div>
      ) : null}

      {versions.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid #e2e8f0',
            flexWrap: 'wrap',
          }}
        >
          <select
            data-testid="design-doc-version-select"
            value={current?.version ?? ''}
            onChange={(e) => {
              setShowDiff(false)
              void selectVersion(Number(e.target.value))
            }}
            style={{
              fontSize: 12,
              padding: '3px 4px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              maxWidth: 170,
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version} · {STATUS_LABEL[v.status]} · {formatDate(v.generatedAt ?? v.createdAt)}
              </option>
            ))}
          </select>
          {content && boardId != null ? (
            <>
              <a
                data-testid="design-doc-download"
                href={designDocDownloadUrl(boardId, current!.version)}
                download="DESIGN.md"
                style={btn}
              >
                Pobierz
              </a>
              <button type="button" data-testid="design-doc-copy" onClick={copy} style={btn}>
                Kopiuj
              </button>
            </>
          ) : null}
          {canDiff ? (
            <button
              type="button"
              data-testid="design-doc-diff-toggle"
              onClick={() => setShowDiff((v) => !v)}
              style={{ ...btn, background: showDiff ? '#eef2ff' : '#fff' }}
              title={`Porównaj z wersją ${previous!.version}`}
            >
              {showDiff ? 'Podgląd' : `Diff z v${previous!.version}`}
            </button>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 16px' }}>
        {loading && !current ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>Ładowanie…</p>
        ) : !current ? (
          active ? null : (
            <div
              data-testid="design-doc-empty"
              style={{ color: '#475569', fontSize: 13, lineHeight: 1.6 }}
            >
              <p style={{ fontWeight: 600, color: '#0f172a' }}>Brak DESIGN.md</p>
              <p>
                Dodaj na tablicę zrzuty ekranu, logo, inspiracje, linki i notatki. Strzałkami pokaż
                przepływ między ekranami, ramkami pogrupuj materiały. Potem kliknij{' '}
                <strong>Generuj DESIGN.md</strong> — AI opisze produkt, ekrany, komponenty i tokeny
                wizualne tak, żeby inne AI mogło zbudować z tego interfejs.
              </p>
            </div>
          )
        ) : current.status === 'failed' ? (
          <div
            data-testid="design-doc-error"
            style={{
              margin: '12px 0',
              padding: 12,
              borderRadius: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: 13,
            }}
          >
            <strong>Wersja {current.version} nie powstała.</strong>
            <div style={{ marginTop: 4 }}>{current.error ?? 'Nieznany błąd'}</div>
            <button
              type="button"
              onClick={() => void generate({ force: true })}
              style={{ ...btn, marginTop: 8 }}
              disabled={Boolean(active)}
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : current.status !== 'ready' ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>Ta wersja jest jeszcze generowana…</p>
        ) : (
          <>
            {reusedNotice ? (
              <div
                style={{
                  margin: '10px 0',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  fontSize: 12,
                  color: '#92400e',
                }}
              >
                Tablica nie zmieniła się od tej wersji.{' '}
                <button
                  type="button"
                  onClick={() => void generate({ force: true })}
                  style={{ ...btn, padding: '1px 6px' }}
                >
                  Wygeneruj mimo to
                </button>
              </div>
            ) : null}

            {diff ? (
              <DiffView lines={diff} />
            ) : (
              <div data-testid="design-doc-content">
                <MarkdownView
                  source={content}
                  assetLabel={assetLabel}
                  onAssetRef={(id) => centerOnAsset(String(id))}
                />
              </div>
            )}

            {current.usage ? (
              <div style={{ marginTop: 16, fontSize: 11, color: '#94a3b8' }}>
                {current.model} · prompt {current.promptVersion} · {current.usage.assets} assetów (
                {current.usage.cached} z cache) · {current.usage.tokensIn + current.usage.tokensOut}{' '}
                tokenów · {(current.usage.durationMs / 1000).toFixed(1)} s
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function DiffView({ lines }: { lines: ReturnType<typeof diffLines> }) {
  const stats = diffStats(lines)
  return (
    <div data-testid="design-doc-diff" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 6, color: '#475569' }}>
        <span style={{ color: '#15803d' }}>+{stats.added}</span>{' '}
        <span style={{ color: '#b91c1c' }}>−{stats.removed}</span> linii
      </div>
      <pre
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          lineHeight: 1.5,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              background:
                line.type === 'added' ? '#dcfce7' : line.type === 'removed' ? '#fee2e2' : undefined,
              color: line.type === 'same' ? '#64748b' : '#0f172a',
              padding: '0 4px',
            }}
          >
            {line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  '}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
