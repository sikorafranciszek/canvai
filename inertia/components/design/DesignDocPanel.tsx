/**
 * Panel DESIGN.md: stan generacji z krokami i postępem, podgląd dokumentu ze
 * spisem sekcji, wybór wersji, diff z poprzednią wersją, pobieranie, kopiowanie
 * i ponowna generacja.
 */
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  Clock,
  Copy,
  Cpu,
  Download,
  FileText,
  GitCompare,
  Layers,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { diffLines, diffStats } from '@shared/line-diff'
import { designDocDownloadUrl, type DesignDocDto } from '~/lib/board/api'
import { progressLabel, progressRatio, useDesignStore } from '~/lib/board/design'
import { useBoardStore, useCanvasAssets } from '~/lib/board/session'
import { MarkdownView, sectionTitles } from '~/components/design/MarkdownView'
import { formatDateTime, plural, relativeTime } from '~/lib/format'

const STATUS_LABEL: Record<DesignDocDto['status'], string> = {
  queued: 'w kolejce',
  running: 'w toku',
  ready: 'gotowa',
  failed: 'błąd',
}

const STAGES = [
  { key: 'analyze', label: 'Analiza materiałów' },
  { key: 'compose', label: 'Składanie dokumentu' },
  { key: 'render', label: 'Formatowanie' },
] as const

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
  const canvasAssets = useCanvasAssets()
  const centerOnAsset = useBoardStore((s) => s.centerOnAsset)

  const [showDiff, setShowDiff] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const assetLabel = (id: number) =>
    assets.find((a) => String(a.id) === String(id))?.filename ?? null

  const content = current?.status === 'ready' ? (current.contentMd ?? '') : ''
  const canDiff = Boolean(content && previous?.contentMd)
  const sections = useMemo(() => (content ? sectionTitles(content) : []), [content])

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

  const jumpTo = (index: number) => {
    setShowDiff(false)
    requestAnimationFrame(() => {
      const target = scroller.current?.querySelector(`#doc-section-${index}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div
      data-testid="design-doc-panel"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {versions.length > 0 ? (
        <div className="panel-toolbar">
          <label style={{ flex: 1, minWidth: 0 }}>
            <span className="sr-only">Wersja dokumentu</span>
            <select
              className="select select--sm"
              data-testid="design-doc-version-select"
              value={current?.version ?? ''}
              onChange={(e) => {
                setShowDiff(false)
                void selectVersion(Number(e.target.value))
              }}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  Wersja {v.version} · {STATUS_LABEL[v.status]} ·{' '}
                  {relativeTime(v.generatedAt ?? v.createdAt)}
                </option>
              ))}
            </select>
          </label>
          {canDiff ? (
            <button
              type="button"
              className="chip"
              aria-pressed={showDiff}
              data-testid="design-doc-diff-toggle"
              onClick={() => setShowDiff((v) => !v)}
              data-tip={`Porównaj z wersją ${previous!.version}`}
            >
              <GitCompare size={14} />
              Diff
            </button>
          ) : null}
          {content && boardId != null ? (
            <>
              <button
                type="button"
                className="btn btn--quiet btn--icon btn--sm"
                data-testid="design-doc-copy"
                onClick={copy}
                aria-label="Kopiuj markdown"
                data-tip="Kopiuj"
              >
                <Copy />
              </button>
              <a
                className="btn btn--icon btn--sm"
                data-testid="design-doc-download"
                href={designDocDownloadUrl(boardId, current!.version)}
                download="DESIGN.md"
                aria-label="Pobierz DESIGN.md"
                data-tip="Pobierz .md"
              >
                <Download />
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {active ? <GenerationProgress doc={active} /> : null}

      <div className="panel-scroll" ref={scroller}>
        {loading && !current ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ height: 20, width: '60%' }} />
            <div className="skeleton" style={{ height: 12 }} />
            <div className="skeleton" style={{ height: 12, width: '85%' }} />
            <div className="skeleton" style={{ height: 12, width: '70%' }} />
          </div>
        ) : !current ? (
          active ? null : (
            <EmptyDoc onGenerate={() => void generate()} hasAssets={canvasAssets.length > 0} />
          )
        ) : current.status === 'failed' ? (
          <div style={{ padding: 16 }}>
            <div className="alert alert--danger" data-testid="design-doc-error" role="alert">
              <AlertCircle />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 500 }}>Wersja {current.version} nie powstała</div>
                  <div>{current.error ?? 'Nieznany błąd'}</div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void generate({ force: true })}
                    disabled={Boolean(active)}
                  >
                    <RefreshCw />
                    Spróbuj ponownie
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : current.status !== 'ready' ? (
          <div className="panel-empty">Ta wersja jest jeszcze generowana…</div>
        ) : (
          <>
            {reusedNotice ? (
              <div className="alert alert--notice" style={{ margin: '12px 16px 0' }}>
                <FileText />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span>
                    Tablica nie zmieniła się od tej wersji — pokazuję istniejący dokument.
                  </span>
                  <div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void generate({ force: true })}
                    >
                      <RefreshCw />
                      Wygeneruj mimo to
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {diff ? (
              <DiffView
                lines={diff}
                previousVersion={previous!.version}
                currentVersion={current.version}
              />
            ) : (
              <>
                {sections.length ? (
                  <nav className="doc-outline" aria-label="Sekcje dokumentu">
                    {sections.slice(0).map((title, i) => (
                      <button
                        key={title}
                        type="button"
                        className="badge badge--outline"
                        style={{ cursor: 'pointer' }}
                        onClick={() => jumpTo(i)}
                        title={title}
                      >
                        {shortTitle(title)}
                      </button>
                    ))}
                  </nav>
                ) : null}
                <div data-testid="design-doc-content">
                  <MarkdownView
                    source={content}
                    assetLabel={assetLabel}
                    onAssetRef={(id) => centerOnAsset(String(id))}
                  />
                </div>
              </>
            )}

            <DocMeta doc={current} />
          </>
        )}
      </div>
    </div>
  )
}

/** „Tokens — Colors” → „Colors”, „Do's and Don'ts” bez zmian, stare „1. Przegląd produktu” → „Przegląd”. */
function shortTitle(title: string): string {
  const bare = title.replace(/^Tokens\s+[—-]\s+/, '').replace(/^\d+\.\s*/, '')
  return /^\d+\.\s/.test(title) ? bare.split(/\s+/)[0] : bare
}

function GenerationProgress({ doc }: { doc: DesignDocDto }) {
  const stageIndex = doc.progress ? STAGES.findIndex((s) => s.key === doc.progress!.stage) : -1
  return (
    <div
      className="doc-status"
      data-testid="design-doc-status"
      data-status={doc.status}
      role="status"
      aria-live="polite"
    >
      <div className="doc-status__row">
        <span className="spinner" />
        <span style={{ fontWeight: 500 }}>Generowanie wersji {doc.version}</span>
        <span className="t-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {progressLabel(doc)}
        </span>
      </div>
      <div className="progress">
        <div
          className="progress__bar"
          style={{ width: `${Math.round(progressRatio(doc) * 100)}%` }}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
        {STAGES.map((stage, i) => (
          <span
            key={stage.key}
            style={{
              color: i <= stageIndex ? 'var(--color-ink)' : 'var(--color-ash)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span className="dot" style={{ opacity: i <= stageIndex ? 1 : 0.4 }} />
            {stage.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function EmptyDoc({ onGenerate, hasAssets }: { onGenerate: () => void; hasAssets: boolean }) {
  const points = [
    'Przegląd produktu i ekrany z przepływami',
    'Inwentarz komponentów ze stanami',
    'Tokeny: kolory, typografia, odstępy',
    'Otwarte pytania i źródła każdego twierdzenia',
  ]
  return (
    <div className="panel-empty" data-testid="design-doc-empty">
      <div className="empty-state__icon">
        <Sparkles />
      </div>
      <div style={{ color: 'var(--color-ink)', fontWeight: 500, fontSize: 15 }}>Brak DESIGN.md</div>
      <p>
        AI przeanalizuje materiały, notatki i układ tablicy, a potem napisze specyfikację, z której
        inne AI zbuduje spójny interfejs.
      </p>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'none' }}>
        {points.map((p) => (
          <li key={p} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="dot" style={{ color: 'var(--color-deep-teal)' }} />
            {p}
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onGenerate}
          disabled={!hasAssets}
        >
          <Sparkles />
          Generuj DESIGN.md
        </button>
      </div>
      {!hasAssets ? (
        <span className="t-small t-faint">Najpierw dodaj materiały na tablicę.</span>
      ) : null}
    </div>
  )
}

function DocMeta({ doc }: { doc: DesignDocDto }) {
  const u = doc.usage
  return (
    <div className="doc-meta">
      <span title={formatDateTime(doc.generatedAt)}>
        <Clock />
        {relativeTime(doc.generatedAt)}
      </span>
      {doc.model ? (
        <span>
          <Cpu />
          {doc.model} · prompt {doc.promptVersion}
        </span>
      ) : null}
      {u ? (
        <>
          <span>
            <Layers />
            {plural(u.assets, 'materiał', 'materiały', 'materiałów')} ({u.cached} z cache)
          </span>
          <span>{u.tokensIn + u.tokensOut} tokenów</span>
          <span>{(u.durationMs / 1000).toFixed(1)} s</span>
        </>
      ) : null}
    </div>
  )
}

function DiffView({
  lines,
  previousVersion,
  currentVersion,
}: {
  lines: ReturnType<typeof diffLines>
  previousVersion: number
  currentVersion: number
}) {
  const stats = diffStats(lines)
  return (
    <div data-testid="design-doc-diff">
      <div className="diff__stats">
        <span>
          Wersja {previousVersion} → {currentVersion}
        </span>
        <span style={{ color: 'var(--color-deep-teal)' }}>+{stats.added}</span>
        <span style={{ color: 'var(--color-danger)' }}>−{stats.removed}</span>
      </div>
      <div className="diff">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`diff__line${line.type === 'same' ? '' : ` diff__line--${line.type}`}`}
          >
            {line.text || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}
