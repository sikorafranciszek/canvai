/**
 * Panel DESIGN.md: stan generacji z krokami i postępem, podgląd dokumentu ze
 * spisem sekcji, wybór wersji, diff z poprzednią wersją, pobieranie, kopiowanie
 * i ponowna generacja.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
  Maximize2,
  Minimize2,
  Check,
  X,
  Wand2,
  BadgeCheck,
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
import {
  designDocDownloadUrl,
  getDesignDocChanges,
  REVISABLE_SECTIONS,
  type RevisableSection,
  type DesignDocDto,
  type SpecChangesDto,
} from '~/lib/board/api'
import { SpecChanges } from '~/components/design/SpecChanges'
import { progressLabel, progressRatio, useDesignStore } from '~/lib/board/design'
import { useBoardStore, useCanEdit, useCanvasAssets } from '~/lib/board/session'
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
  const approved = useDesignStore((s) => s.approved)
  const setApproval = useDesignStore((s) => s.setApproval)
  const limits = useBillingStore((s) => s.summary?.limits)
  const showPreview = usePreviewStore((s) => s.show)

  const { t, tp } = useT()
  const estimate = useDesignStore((s) => s.estimate)
  // Koszt ponownej generacji widoczny na przycisku, nie tylko w podpowiedzi (UX-11).
  const retryCost =
    estimate?.enforced && !estimate.unchanged && estimate.credits > 0
      ? ` · ${tp('count.credits', estimate.credits)}`
      : ''
  const assets = useBoardStore((s) => s.assets)
  const canEdit = useCanEdit()
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
  const readMode = useDesignStore((s) => s.readMode)
  const sample = useDesignStore((s) => s.sample)
  const setReadMode = useDesignStore((s) => s.setReadMode)
  const compareWith = useDesignStore((s) => s.compareWith)
  // Wersje do porównania: gotowe, inne niż bieżąca (UX-6).
  const compareOptions = versions.filter(
    (v) => v.status === 'ready' && v.version !== current?.version
  )
  const sections = useMemo(() => (content ? sectionTitles(content) : []), [content])

  const diff = useMemo(
    () => (showDiff && canDiff ? diffLines(previous!.contentMd!, content) : null),
    [showDiff, canDiff, previous, content]
  )
  // Zmiany „po ludzku” (FEAT-1): tokeny było → jest i przyczyny; linie na życzenie.
  const [diffMode, setDiffMode] = useState<'changes' | 'lines'>('changes')
  const [specChanges, setSpecChanges] = useState<{
    from: number
    to: number
    changes: SpecChangesDto
  } | null>(null)
  useEffect(() => {
    setSpecChanges(null)
    if (!showDiff || boardId == null || !current || !previous) return
    let alive = true
    getDesignDocChanges(boardId, current.version, previous.version)
      .then((data) => alive && setSpecChanges(data))
      .catch(() => alive && setSpecChanges(null))
    return () => {
      alive = false
    }
  }, [showDiff, boardId, current?.version, previous?.version])

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
                  {approved?.version === v.version ? ` · ${t('approval.badge')}` : ''}
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
          {showDiff && canDiff && compareOptions.length > 1 ? (
            <label>
              <span className="sr-only">{t('doc.compareWith')}</span>
              <select
                className="select select--sm"
                data-testid="design-doc-compare-select"
                value={previous!.version}
                onChange={(e) => void compareWith(Number(e.target.value))}
              >
                {compareOptions.map((v) => (
                  <option key={v.id} value={v.version}>
                    {t('doc.compareWith')} v{v.version}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn--quiet btn--icon btn--sm"
            data-testid="design-doc-read-mode"
            aria-pressed={readMode}
            aria-label={readMode ? t('doc.readModeExit') : t('doc.readMode')}
            data-tip={readMode ? t('doc.readModeExit') : t('doc.readMode')}
            onClick={() => setReadMode(!readMode)}
          >
            {readMode ? <Minimize2 /> : <Maximize2 />}
          </button>
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
              {canEdit && current?.status === 'ready' ? (
                <button
                  type="button"
                  className="btn btn--quiet btn--icon btn--sm"
                  data-testid="design-doc-approve"
                  aria-pressed={approved?.version === current.version}
                  aria-label={
                    approved?.version === current.version
                      ? t('approval.remove')
                      : t('approval.approve', { version: current.version })
                  }
                  data-tip={
                    approved?.version === current.version
                      ? t('approval.remove')
                      : t('approval.approveTip')
                  }
                  onClick={() =>
                    void setApproval(approved?.version === current.version ? null : current.version)
                  }
                >
                  <BadgeCheck />
                </button>
              ) : null}
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
                className="btn btn--sm"
                data-testid="design-doc-download"
                href={designDocDownloadUrl(boardId, current!.version)}
                download="DESIGN.md"
                aria-label={t('doc.downloadLabel')}
                data-tip={t('doc.downloadTip')}
              >
                <Download />
                {t('doc.download')}
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

      {sample && canEdit && current?.status === 'ready' ? <SampleChecklist /> : null}
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
            <EmptyDoc
              onGenerate={canEdit ? () => void generate() : undefined}
              hasAssets={canvasAssets.length > 0}
            />
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
                <div hidden={!canEdit}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void generate({ force: true })}
                    disabled={Boolean(active)}
                  >
                    <RefreshCw />
                    {t('common.retry')}
                    {retryCost}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : current.status !== 'ready' ? (
          <div className="panel-empty">{t('doc.stillGenerating')}</div>
        ) : (
          <>
            {reusedNotice && canEdit ? (
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
                      {retryCost}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!current.quality && current.status === 'ready' ? (
              <p className="t-small t-muted" style={{ margin: '12px 16px 0' }}>
                {t('doc.noQuality')}
              </p>
            ) : null}
            {current.quality ? (
              <div className="doc-views">
                <div className="segmented segmented--text" role="group" aria-label={t('doc.views')}>
                  {(canEdit
                    ? (['doc', 'quality', 'tokens'] as const)
                    : (['doc', 'quality'] as const)
                  ).map((v) => (
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
                {approved?.version === current.version ? (
                  <span className="badge badge--success" data-testid="design-doc-approved">
                    <BadgeCheck size={12} />
                    {approved.by ? t('approval.byWho', { who: approved.by }) : t('approval.badge')}
                  </span>
                ) : approved ? (
                  <span className="t-small t-muted" data-testid="design-doc-approved-other">
                    {t('approval.other', { version: approved.version })}
                  </span>
                ) : null}
                {current.instruction ? (
                  <span className="t-small t-muted" data-testid="design-doc-instruction">
                    {t('revise.from', { version: current.editedFromVersion ?? '?' })}
                    {current.revisedSection
                      ? ` · ${t(`revise.section.${current.revisedSection}` as MessageKey)}`
                      : ''}
                    : „{current.instruction}”
                  </span>
                ) : current.editedFromVersion ? (
                  <span className="t-small t-muted">
                    {t('doc.editedFrom', { version: current.editedFromVersion })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {view === 'quality' && current.quality && !diff ? (
              <QualityView doc={current} onEdit={canEdit ? () => setView('tokens') : undefined} />
            ) : view === 'tokens' && current.tokens && !diff ? (
              <TokenEditor key={current.version} doc={current} />
            ) : diff ? (
              <>
                <div
                  className="segmented segmented--text"
                  role="group"
                  aria-label={t('doc.diff')}
                  style={{ margin: '12px 16px 0' }}
                >
                  {(['changes', 'lines'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={diffMode === m}
                      data-testid={`design-doc-diff-${m}`}
                      onClick={() => setDiffMode(m)}
                    >
                      {t(m === 'changes' ? 'doc.changesView' : 'doc.linesView')}
                    </button>
                  ))}
                </div>
                {diffMode === 'changes' && specChanges ? (
                  <SpecChanges {...specChanges} />
                ) : (
                  <DiffView
                    lines={diff}
                    previousVersion={previous!.version}
                    currentVersion={current.version}
                  />
                )}
              </>
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
      {canEdit &&
      current?.status === 'ready' &&
      current.hasSpec !== false &&
      !(active && (active.status === 'queued' || active.status === 'running')) ? (
        <RevisePanel key={current.version} />
      ) : null}
      {canEdit ? <GenerationOptions /> : null}
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

/**
 * Pierwsze kroki na tablicy przykładowej (UX-5): obejrzyj dokument, zmień rolę
 * materiału, wygeneruj ponownie. Stan wynika z danych (role, liczba wersji),
 * zamknięcie pamiętane w przeglądarce.
 */
function SampleChecklist() {
  const { t } = useT()
  const boardId = useDesignStore((s) => s.boardId)
  const versions = useDesignStore((s) => s.versions)
  const setTab = useDesignStore((s) => s.setTab)
  const assets = useCanvasAssets()
  const key = `canvai.sampleChecklist.${boardId}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === 'done'
    } catch {
      return false
    }
  })
  if (dismissed || boardId == null) return null
  const steps = [
    { label: t('sample.step.read'), done: true },
    {
      label: t('sample.step.role'),
      done: assets.some((a) => a.usage && (a.usage.role || a.usage.aspects.length)),
      action: () => setTab('assets'),
    },
    {
      label: t('sample.step.regenerate'),
      done: versions.filter((v) => v.status === 'ready').length > 1,
    },
  ]
  const close = () => {
    setDismissed(true)
    try {
      localStorage.setItem(key, 'done')
    } catch {
      // bez localStorage lista wróci po odświeżeniu
    }
  }
  return (
    <div className="sample-checklist" data-testid="sample-checklist">
      <div className="sample-checklist__head">
        <strong>{t('sample.title')}</strong>
        <button
          type="button"
          className="btn btn--quiet btn--icon btn--sm"
          aria-label={t('common.close')}
          onClick={close}
        >
          <X />
        </button>
      </div>
      <p className="t-small t-muted">{t('sample.body')}</p>
      <ol className="sample-checklist__steps">
        {steps.map((step, i) => (
          <li key={step.label} data-done={step.done}>
            <span className="sample-checklist__mark" aria-hidden="true">
              {step.done ? <Check size={12} /> : i + 1}
            </span>
            {step.action && !step.done ? (
              <button type="button" className="link-button" onClick={step.action}>
                {step.label}
              </button>
            ) : (
              <span>{step.label}</span>
            )}
            <span className="sr-only">{step.done ? t('sample.done') : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function GenerationProgress({ doc }: { doc: DesignDocDto }) {
  const { t } = useT()
  const canEdit = useCanEdit()
  const cancel = useDesignStore((s) => s.cancel)
  const [cancelling, setCancelling] = useState(false)
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
        {canEdit ? (
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            data-testid="design-doc-cancel"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true)
              await cancel()
              setCancelling(false)
            }}
          >
            {t('common.cancel')}
          </button>
        ) : null}
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

function EmptyDoc({ onGenerate, hasAssets }: { onGenerate?: () => void; hasAssets: boolean }) {
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
      {onGenerate ? (
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
      ) : (
        <span className="t-small t-faint">{t('doc.empty.viewerOnly')}</span>
      )}
      {onGenerate && !hasAssets ? (
        <span className="t-small t-faint">{t('doc.empty.needAssets')}</span>
      ) : null}
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
/**
 * Poprawka poleceniem albo regeneracja jednej sekcji (FEAT-2): „ciemniejszy
 * primary”, „bez serifów” — nowa wersja na bazie bieżącej, reszta bez zmian.
 */
function RevisePanel() {
  const { t, tp } = useT()
  const revise = useDesignStore((s) => s.revise)
  const starting = useDesignStore((s) => s.starting)
  const summary = useBillingStore((s) => s.summary)
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [section, setSection] = useState<RevisableSection | ''>('')
  const text = instruction.trim()
  const valid = text.length >= 3
  const cost = summary?.enforced ? (summary.revisionCost ?? null) : null

  const submit = async () => {
    if (!valid || starting) return
    if (await revise(text, section || undefined)) {
      setInstruction('')
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <div className="revise revise--closed">
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          data-testid="revise-open"
          onClick={() => setOpen(true)}
        >
          <Wand2 size={14} />
          {t('revise.open')}
        </button>
      </div>
    )
  }
  return (
    <form
      className="revise"
      data-testid="revise-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="sr-only" htmlFor="revise-instruction">
        {t('revise.label')}
      </label>
      <textarea
        id="revise-instruction"
        className="textarea revise__input"
        data-testid="revise-instruction"
        rows={2}
        maxLength={500}
        autoFocus
        placeholder={t('revise.placeholder')}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <div className="revise__row">
        <label className="sr-only" htmlFor="revise-section">
          {t('revise.sectionLabel')}
        </label>
        <select
          id="revise-section"
          className="select select--sm"
          data-testid="revise-section"
          value={section}
          onChange={(e) => setSection(e.target.value as RevisableSection | '')}
        >
          <option value="">{t('revise.section.all')}</option>
          {REVISABLE_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`revise.section.${s}` as MessageKey)}
            </option>
          ))}
        </select>
        <span className="revise__actions">
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            data-testid="revise-submit"
            disabled={!valid || starting}
          >
            {cost != null
              ? t('revise.applyCost', { credits: tp('count.credits', cost) })
              : t('revise.apply')}
          </button>
        </span>
      </div>
      <p className="t-small t-muted revise__hint">
        {section ? t('revise.hintSection') : t('revise.hintAll')}
      </p>
    </form>
  )
}

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
