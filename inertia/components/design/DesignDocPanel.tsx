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
  Download,
  Eye,
  Bookmark,
  FileText,
  GitCompare,
  Layers,
  Coins,
  FileCode2,
  Lock,
  RefreshCw,
  Sparkles,
  Bot,
  Printer,
} from 'lucide-react'
import { router } from '@inertiajs/react'
import { Menu } from '~/components/ui/Menu'
import { exportUrl, useBillingStore } from '~/lib/billing'
import { usePreviewStore } from '~/lib/board/preview'
import { PreviewDialog } from '~/components/design/PreviewDialog'
import { QualityView, TokenEditor } from '~/components/design/DocInsights'
import { AiToolsDialog } from '~/components/design/AiToolsDialog'
import { createBrandKit, useBrandKitStore } from '~/lib/brand_kits'
import { diffLines, diffStats } from '@shared/line-diff'
import { designDocDownloadUrl, type DesignDocDto } from '~/lib/board/api'
import { progressLabel, progressRatio, useDesignStore } from '~/lib/board/design'
import { useBoardStore, useCanvasAssets } from '~/lib/board/session'
import { MarkdownView, sectionTitles } from '~/components/design/MarkdownView'
import { formatDateTime, relativeTime } from '~/lib/format'
import { useT, type MessageKey } from '~/i18n'

const STATUS_LABEL: Record<DesignDocDto['status'], MessageKey> = {
  queued: 'doc.status.queued',
  running: 'doc.status.running',
  ready: 'doc.status.ready',
  failed: 'doc.status.failed',
}

const STAGES = [
  { key: 'analyze', label: 'doc.stage.analyze' },
  { key: 'compose', label: 'doc.stage.compose' },
  { key: 'render', label: 'doc.stage.render' },
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
  const hiddenVersions = useDesignStore((s) => s.hiddenVersions)
  const limits = useBillingStore((s) => s.summary?.limits)
  const showPreview = usePreviewStore((s) => s.show)

  const { t } = useT()
  const assets = useBoardStore((s) => s.assets)
  const canvasAssets = useCanvasAssets()
  const centerOnAsset = useBoardStore((s) => s.centerOnAsset)

  const [showDiff, setShowDiff] = useState(false)
  const [view, setView] = useState<'doc' | 'quality' | 'tokens'>('doc')
  const [aiTools, setAiTools] = useState(false)
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
      toast.success(t('doc.copied'))
    } catch {
      toast.error(t('doc.copyFailed'))
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
            <span className="sr-only">{t('doc.versionLabel')}</span>
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
                  {t('doc.version', {
                    version: v.version,
                    status: t(STATUS_LABEL[v.status]),
                    when: relativeTime(v.generatedAt ?? v.createdAt),
                  })}
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
              data-tip={t('doc.diffCompare', { version: previous!.version })}
            >
              <GitCompare size={14} />
              {t('doc.diff')}
            </button>
          ) : null}
          {content && boardId != null ? (
            <>
              <button
                type="button"
                className="btn btn--quiet btn--icon btn--sm"
                data-testid="design-doc-copy"
                onClick={copy}
                aria-label={t('doc.copyLabel')}
                data-tip={t('common.copy')}
              >
                <Copy />
              </button>
              <button
                type="button"
                className="btn btn--sm"
                data-testid="design-doc-preview"
                onClick={() => void showPreview(boardId, current!.version)}
                data-tip={t('preview.tip')}
              >
                <Eye />
                {t('preview.button')}
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--icon btn--sm"
                data-testid="design-doc-save-kit"
                aria-label={t('brandKits.save')}
                data-tip={t('brandKits.save')}
                onClick={async () => {
                  try {
                    const kit = await createBrandKit(boardId, current!.version)
                    void useBrandKitStore.getState().load()
                    toast.success(t('brandKits.saved', { name: kit.name }), {
                      action: {
                        label: t('brandKits.manage'),
                        onClick: () => router.visit('/brand-kits'),
                      },
                    })
                  } catch (error) {
                    const status = (error as { status?: number }).status
                    toast.error(error instanceof Error ? error.message : t('brandKits.failed'), {
                      ...(status === 403
                        ? {
                            action: {
                              label: t('billing.upgrade'),
                              onClick: () => router.visit('/billing'),
                            },
                          }
                        : {}),
                    })
                  }
                }}
              >
                <Bookmark />
              </button>
              <Menu
                label={limits?.exports === false ? t('doc.export.locked') : t('doc.export.label')}
                testId="design-doc-export"
                triggerClassName="btn btn--quiet btn--icon btn--sm"
                trigger={limits?.exports === false ? <Lock /> : <FileCode2 />}
                actions={[
                  ...(limits?.exports === false
                    ? [
                        {
                          label: t('doc.export.locked'),
                          icon: <Lock size={14} />,
                          onSelect: () => router.visit('/billing'),
                        },
                      ]
                    : (['css', 'tailwind', 'tailwind3', 'scss', 'tokens', 'figma'] as const).map(
                        (format) => ({
                          label: t(`doc.export.${format}`),
                          icon: <FileCode2 size={14} />,
                          testId: `design-doc-export-${format}`,
                          onSelect: () => {
                            window.location.href = exportUrl(boardId, format, current!.version)
                          },
                        })
                      )),
                  {
                    label: t('doc.export.pdf'),
                    icon: <Printer size={14} />,
                    testId: 'design-doc-export-pdf',
                    onSelect: () => {
                      window.open(
                        `/boards/${boardId}/design-doc/print?version=${current!.version}&autoprint=1`,
                        '_blank',
                        'noopener'
                      )
                    },
                  },
                ]}
              />
              <button
                type="button"
                className="btn btn--quiet btn--icon btn--sm"
                data-testid="design-doc-ai-tools"
                aria-label={t('aiTools.title')}
                data-tip={t('aiTools.title')}
                onClick={() => setAiTools(true)}
              >
                <Bot />
              </button>
              <a
                className="btn btn--icon btn--sm"
                data-testid="design-doc-download"
                href={designDocDownloadUrl(boardId, current!.version)}
                download="DESIGN.md"
                aria-label={t('doc.downloadLabel')}
                data-tip={t('doc.downloadTip')}
              >
                <Download />
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {hiddenVersions > 0 ? (
        <button
          type="button"
          className="panel-note"
          onClick={() => router.visit('/billing')}
          data-testid="design-doc-hidden-versions"
        >
          <Lock size={13} />
          {t('doc.hiddenVersions', { n: hiddenVersions })}
        </button>
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
                  <div style={{ fontWeight: 500 }}>
                    {t('doc.failedTitle', { version: current.version })}
                  </div>
                  <div>{current.error ?? t('doc.unknownError')}</div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void generate({ force: true })}
                    disabled={Boolean(active)}
                  >
                    <RefreshCw />
                    {t('common.retry')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : current.status !== 'ready' ? (
          <div className="panel-empty">{t('doc.stillGenerating')}</div>
        ) : (
          <>
            {reusedNotice ? (
              <div className="alert alert--notice" style={{ margin: '12px 16px 0' }}>
                <FileText />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span>{t('doc.unchanged')}</span>
                  <div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void generate({ force: true })}
                    >
                      <RefreshCw />
                      {t('doc.generateAnyway')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {current.quality ? (
              <div className="doc-views">
                <div className="segmented segmented--text" role="group" aria-label={t('doc.views')}>
                  {(['doc', 'quality', 'tokens'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      data-testid={`design-doc-view-${v}`}
                      onClick={() => {
                        setShowDiff(false)
                        setView(v)
                      }}
                    >
                      {t(`doc.view.${v}`)}
                      {v === 'quality' ? (
                        <span
                          className={`doc-views__score doc-views__score--${current.quality!.score >= 70 ? 'good' : current.quality!.score >= 50 ? 'warning' : 'critical'}`}
                        >
                          {current.quality!.score}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {current.editedFromVersion ? (
                  <span className="t-small t-muted">
                    {t('doc.editedFrom', { version: current.editedFromVersion })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {view === 'quality' && current.quality && !diff ? (
              <QualityView doc={current} onEdit={() => setView('tokens')} />
            ) : view === 'tokens' && current.tokens && !diff ? (
              <TokenEditor key={current.version} doc={current} />
            ) : diff ? (
              <DiffView
                lines={diff}
                previousVersion={previous!.version}
                currentVersion={current.version}
              />
            ) : (
              <>
                {sections.length ? (
                  <nav className="doc-outline" aria-label={t('doc.sections')}>
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
      <GenerationOptions />
      <PreviewDialog />
      {boardId != null && current?.status === 'ready' ? (
        <AiToolsDialog
          open={aiTools}
          onClose={() => setAiTools(false)}
          boardId={boardId}
          version={current.version}
          allowed={limits?.exports !== false}
        />
      ) : null}
    </div>
  )
}

/** „Tokens — Colors” → „Colors”, „Do's and Don'ts” bez zmian, stare „1. Przegląd produktu” → „Przegląd”. */
function shortTitle(title: string): string {
  const bare = title.replace(/^Tokens\s+[—-]\s+/, '').replace(/^\d+\.\s*/, '')
  return /^\d+\.\s/.test(title) ? bare.split(/\s+/)[0] : bare
}

function GenerationProgress({ doc }: { doc: DesignDocDto }) {
  const { t } = useT()
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
        <span style={{ fontWeight: 500 }}>
          {t('doc.generatingVersion', { version: doc.version })}
        </span>
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
            {t(stage.label)}
          </span>
        ))}
      </div>
    </div>
  )
}

function EmptyDoc({ onGenerate, hasAssets }: { onGenerate: () => void; hasAssets: boolean }) {
  const { t } = useT()
  const points = [
    t('doc.empty.point1'),
    t('doc.empty.point2'),
    t('doc.empty.point3'),
    t('doc.empty.point4'),
  ]
  return (
    <div className="panel-empty" data-testid="design-doc-empty">
      <div className="empty-state__icon">
        <Sparkles />
      </div>
      <div style={{ color: 'var(--color-ink)', fontWeight: 500, fontSize: 15 }}>
        {t('doc.empty.title')}
      </div>
      <p>{t('doc.empty.body')}</p>
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
          {t('editor.generate')}
        </button>
      </div>
      {!hasAssets ? <span className="t-small t-faint">{t('doc.empty.needAssets')}</span> : null}
    </div>
  )
}

function DocMeta({ doc }: { doc: DesignDocDto }) {
  const { t, tp } = useT()
  const u = doc.usage
  return (
    <div className="doc-meta">
      <span title={formatDateTime(doc.generatedAt)}>
        <Clock />
        {relativeTime(doc.generatedAt)}
      </span>
      {u ? (
        <>
          <span>
            <Layers />
            {t('doc.meta.materials', {
              materials: tp('count.materials', u.assets),
              cached: u.cached,
            })}
          </span>
          <span>{t('doc.meta.tokens', { n: u.tokensIn + u.tokensOut })}</span>
          <span>{(u.durationMs / 1000).toFixed(1)} s</span>
          {doc.creditsCharged ? (
            <span>
              <Coins />
              {t('doc.meta.credits', { credits: tp('count.credits', doc.creditsCharged) })}
            </span>
          ) : null}
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
  const { t } = useT()
  const stats = diffStats(lines)
  return (
    <div data-testid="design-doc-diff">
      <div className="diff__stats">
        <span>{t('doc.diffRange', { from: previousVersion, to: currentVersion })}</span>
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

/** Pasek pod dokumentem: koszt następnej generacji i przełącznik Pro reasoning. */
function GenerationOptions() {
  const { t, tp } = useT()
  const estimate = useDesignStore((s) => s.estimate)
  const proMode = useDesignStore((s) => s.proMode)
  const setProMode = useDesignStore((s) => s.setProMode)
  const summary = useBillingStore((s) => s.summary)
  if (!summary?.enforced) return null

  const allowed = summary.limits.proReasoning
  return (
    <div className="gen-options" data-testid="generation-options">
      <span className="gen-options__cost">
        <Coins size={14} />
        {estimate
          ? estimate.unchanged
            ? t('doc.costUnchanged')
            : t('doc.cost', {
                credits: tp('count.credits', estimate.credits),
                balance: estimate.balance,
              })
          : '…'}
      </span>
      <label
        className="gen-options__pro"
        data-tip={allowed ? t('doc.pro.hint') : t('doc.pro.locked')}
        data-tip-side="top"
      >
        <input
          type="checkbox"
          className="switch"
          checked={proMode && allowed}
          disabled={!allowed}
          onChange={(e) => setProMode(e.target.checked)}
          data-testid="pro-mode-toggle"
        />
        {allowed ? null : <Lock size={12} />}
        {t('doc.pro.label')}
      </label>
    </div>
  )
}
