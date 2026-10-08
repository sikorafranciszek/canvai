/**
 * Kontrolki pływające nad płótnem:
 * - pasek narzędzi (góra, środek) z ikonami i skrótami,
 * - pasek właściwości zaznaczenia (kolory, grubość, kolejność, duplikuj, usuń),
 * - kontrolki widoku (lewy dół): zoom, dopasowanie, reset.
 *
 * Zmiany właściwości idą przez `commitGesture`, więc są cofane Ctrl+Z.
 */
import type React from 'react'
import {
  ArrowUpRight,
  BringToFront,
  Circle,
  Copy,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  SendToBack,
  Slash,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Frame,
} from 'lucide-react'
import type { SceneElement } from '@shared/scene'
import { TOOLS, toolTestId, type Tool } from '@shared/tools'
import { useSceneStore } from '~/lib/scene/store'
import { getElementBounds } from '~/lib/scene/geometry'
import { FILL_COLORS, STICKY_COLORS, STROKE_COLORS } from '~/lib/scene/palette'
import { shortcut } from '~/lib/keys'
import { useT, type MessageKey } from '~/i18n'

const TOOL_ICONS: Record<Tool, React.ComponentType> = {
  select: MousePointer2,
  pan: Hand,
  frame: Frame,
  rectangle: Square,
  ellipse: Circle,
  line: Slash,
  arrow: ArrowUpRight,
  freehand: Pencil,
  text: Type,
  sticky: StickyNote,
}

const MIN_SCALE = 0.1
const MAX_SCALE = 8

function viewportSize() {
  const rect = document.querySelector('[data-testid="canvas-root"]')?.getBoundingClientRect()
  return { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight }
}

/** Zoom względem środka widoku. */
function zoomBy(factor: number) {
  const { camera, setCamera } = useSceneStore.getState()
  const { width, height } = viewportSize()
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor))
  const cx = width / 2
  const cy = height / 2
  const wx = (cx - camera.x) / camera.scale
  const wy = (cy - camera.y) / camera.scale
  setCamera({ x: cx - wx * scale, y: cy - wy * scale, scale })
}

function fitToContent() {
  const { document, setCamera } = useSceneStore.getState()
  const { width, height } = viewportSize()
  const els = document.elements
  if (els.length === 0) {
    setCamera({ x: 0, y: 0, scale: 1 })
    return
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of els) {
    const b = getElementBounds(el)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  const padding = 80
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const scale = Math.min((width - padding * 2) / contentW, (height - padding * 2) / contentH, 2)
  const safe = Math.max(MIN_SCALE, scale)
  setCamera({
    x: (width - contentW * safe) / 2 - minX * safe,
    y: (height - contentH * safe) / 2 - minY * safe,
    scale: safe,
  })
}

export function Toolbar() {
  const tool = useSceneStore((s) => s.tool)
  const setTool = useSceneStore((s) => s.setTool)
  const canUndo = useSceneStore((s) => s.canUndo)
  const canRedo = useSceneStore((s) => s.canRedo)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)
  const scale = useSceneStore((s) => s.camera.scale)
  const { t } = useT()

  return (
    <>
      <div
        className="float float--toolbar"
        role="toolbar"
        aria-label={t('tools.label')}
        data-testid="toolbar"
      >
        {TOOLS.map((def) => {
          const Icon = TOOL_ICONS[def.id]
          return (
            <button
              key={def.id}
              type="button"
              className="tool-btn"
              data-testid={toolTestId(def.id)}
              aria-label={t(`tool.${def.id}`)}
              aria-pressed={tool === def.id}
              data-tip={
                def.shortcut ? `${t(`tool.${def.id}`)} · ${def.shortcut}` : t(`tool.${def.id}`)
              }
              onClick={() => setTool(def.id)}
            >
              <Icon />
              {def.shortcut ? <span className="tool-btn__key">{def.shortcut}</span> : null}
            </button>
          )
        })}
        <span className="float__sep" aria-hidden />
        <button
          type="button"
          className="tool-btn"
          data-testid="undo"
          onClick={undo}
          disabled={!canUndo}
          aria-label={t('tools.undo')}
          data-tip={`${t('tools.undo')} · ${shortcut('Z')}`}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          className="tool-btn"
          data-testid="redo"
          onClick={redo}
          disabled={!canRedo}
          aria-label={t('tools.redo')}
          data-tip={`${t('tools.redo')} · ${shortcut('Shift', 'Z')}`}
        >
          <Redo2 />
        </button>
      </div>

      <SelectionBar />

      <div className="float float--zoom" role="group" aria-label={t('view.group')}>
        <button
          type="button"
          className="tool-btn"
          onClick={() => zoomBy(1 / 1.25)}
          aria-label={t('view.zoomOut')}
          data-tip={t('view.zoomOut')}
          data-tip-side="top"
          data-testid="zoom-out"
        >
          <Minus />
        </button>
        <button
          type="button"
          className="zoom-value"
          onClick={() => useSceneStore.getState().setCamera({ x: 0, y: 0, scale: 1 })}
          data-testid="reset-view"
          aria-label={t('view.resetLabel')}
          data-tip={t('view.reset')}
          data-tip-side="top"
        >
          <span data-testid="zoom-indicator">{Math.round(scale * 100)}%</span>
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={() => zoomBy(1.25)}
          aria-label={t('view.zoomIn')}
          data-tip={t('view.zoomIn')}
          data-tip-side="top"
          data-testid="zoom-in"
        >
          <Plus />
        </button>
        <span className="float__sep" aria-hidden />
        <button
          type="button"
          className="tool-btn"
          onClick={fitToContent}
          data-testid="fit-to-content"
          aria-label={t('view.fit')}
          data-tip={t('view.fit')}
          data-tip-side="top"
        >
          <Maximize />
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Pasek właściwości zaznaczenia
// ---------------------------------------------------------------------------

type StrokeEl = Extract<SceneElement, { stroke: string }>

const hasStroke = (el: SceneElement): el is StrokeEl =>
  el.type === 'rectangle' ||
  el.type === 'ellipse' ||
  el.type === 'line' ||
  el.type === 'arrow' ||
  el.type === 'freehand'

const hasShapeFill = (el: SceneElement) => el.type === 'rectangle' || el.type === 'ellipse'

const STROKE_WIDTHS = [
  { value: 1.5, label: 'props.width.thin' },
  { value: 2.5, label: 'props.width.medium' },
  { value: 4, label: 'props.width.thick' },
] as const

function applyToSelection(patch: (el: SceneElement) => Partial<SceneElement> | null) {
  const store = useSceneStore.getState()
  const baseline = store.document
  const ids = new Set(store.selection)
  let changed = false
  const next = {
    ...baseline,
    elements: baseline.elements.map((el) => {
      if (!ids.has(el.id)) return el
      const p = patch(el)
      if (!p) return el
      changed = true
      return { ...el, ...p } as SceneElement
    }),
  }
  if (changed) store.commitGesture(baseline, next)
}

function Swatches({
  label,
  colors,
  current,
  onPick,
  testId,
}: {
  label: string
  colors: readonly { value: string; label: MessageKey }[]
  current: string | undefined
  onPick: (value: string) => void
  testId: string
}) {
  const { t } = useT()
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center' }}
      data-testid={testId}
    >
      <span className="props-label">{label}</span>
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          className="swatch-btn"
          aria-label={`${label}: ${t(c.label)}`}
          aria-pressed={current === c.value}
          data-tip={t(c.label)}
          onClick={() => onPick(c.value)}
        >
          <span
            className={`swatch${c.value === 'transparent' ? ' swatch--none' : ''}`}
            style={c.value === 'transparent' ? undefined : { background: c.value }}
          />
        </button>
      ))}
    </div>
  )
}

function SelectionBar() {
  const { t } = useT()
  const selection = useSceneStore((s) => s.selection)
  const elements = useSceneStore((s) => s.document.elements)
  const tool = useSceneStore((s) => s.tool)

  if (tool !== 'select' || selection.length === 0) return null
  const ids = new Set(selection)
  const selected = elements.filter((el) => ids.has(el.id))
  if (selected.length === 0) return null

  const strokeEls = selected.filter(hasStroke)
  const fillEls = selected.filter(hasShapeFill) as Extract<
    SceneElement,
    { type: 'rectangle' | 'ellipse' }
  >[]
  const stickyEls = selected.filter((el) => el.type === 'sticky') as Extract<
    SceneElement,
    { type: 'sticky' }
  >[]
  const textEls = selected.filter((el) => el.type === 'text') as Extract<
    SceneElement,
    { type: 'text' }
  >[]
  const store = useSceneStore.getState()
  const frame =
    selected.length === 1 && selected[0].type === 'rectangle' && selected[0].frameName !== undefined
      ? selected[0]
      : null

  const groups: React.ReactNode[] = []
  if (frame) {
    groups.push(
      <label key="frame-name" className="props-frame-name">
        <span className="sr-only">{t('props.frameName')}</span>
        <input
          key={frame.id}
          className="input input--sm"
          defaultValue={frame.frameName}
          maxLength={60}
          placeholder={t('props.frameName')}
          data-testid="props-frame-name"
          onBlur={(e) => {
            const name = e.target.value.trim() || t('canvas.newFrame')
            if (name !== frame.frameName) {
              applyToSelection((el) => (el.type === 'rectangle' ? { frameName: name } : null))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </label>
    )
  }
  if (strokeEls.length) {
    groups.push(
      <Swatches
        key="stroke"
        label={t('props.stroke')}
        colors={STROKE_COLORS}
        current={strokeEls[0].stroke}
        testId="props-stroke"
        onPick={(value) => applyToSelection((el) => (hasStroke(el) ? { stroke: value } : null))}
      />,
      <div
        key="width"
        role="group"
        aria-label={t('props.width')}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w.value}
            type="button"
            className="tool-btn"
            aria-label={`${t('props.width')}: ${t(w.label)}`}
            aria-pressed={strokeEls[0].strokeWidth === w.value}
            data-tip={t(w.label)}
            onClick={() =>
              applyToSelection((el) => (hasStroke(el) ? { strokeWidth: w.value } : null))
            }
          >
            <span
              style={{ width: 16, height: w.value, background: 'currentColor', borderRadius: 2 }}
            />
          </button>
        ))}
      </div>
    )
  }
  if (fillEls.length) {
    groups.push(
      <Swatches
        key="fill"
        label={t('props.fill')}
        colors={FILL_COLORS}
        current={fillEls[0].fill}
        testId="props-fill"
        onPick={(value) => applyToSelection((el) => (hasShapeFill(el) ? { fill: value } : null))}
      />
    )
  }
  if (stickyEls.length) {
    groups.push(
      <Swatches
        key="sticky"
        label={t('props.sticky')}
        colors={STICKY_COLORS}
        current={stickyEls[0].fill}
        testId="props-sticky"
        onPick={(value) =>
          applyToSelection((el) => (el.type === 'sticky' ? { fill: value } : null))
        }
      />
    )
  }
  if (textEls.length) {
    groups.push(
      <Swatches
        key="text"
        label={t('props.text')}
        colors={STROKE_COLORS}
        current={textEls[0].fill}
        testId="props-text"
        onPick={(value) => applyToSelection((el) => (el.type === 'text' ? { fill: value } : null))}
      />
    )
  }

  return (
    <div
      className="float float--props"
      role="toolbar"
      aria-label={t('props.label')}
      data-testid="selection-bar"
    >
      {groups.map((g, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 ? <span className="float__sep" aria-hidden /> : null}
          {g}
        </span>
      ))}
      {groups.length ? <span className="float__sep" aria-hidden /> : null}
      <span className="props-label">
        {selected.length > 1 ? t('props.selected', { n: selected.length }) : ''}
      </span>
      <button
        type="button"
        className="tool-btn"
        onClick={() => store.reorderSelection('forward')}
        aria-label={t('props.forwardLabel')}
        data-tip={`${t('props.forward')} · ]`}
      >
        <BringToFront />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={() => store.reorderSelection('backward')}
        aria-label={t('props.backwardLabel')}
        data-tip={`${t('props.backward')} · [`}
      >
        <SendToBack />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={() => store.duplicateSelection()}
        aria-label={t('props.duplicate')}
        data-tip={`${t('props.duplicate')} · ${shortcut('D')}`}
        data-testid="props-duplicate"
      >
        <Copy />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={() => store.deleteSelection()}
        aria-label={t('props.delete')}
        data-tip={`${t('props.delete')} · Del`}
        data-testid="props-delete"
      >
        <Trash2 />
      </button>
    </div>
  )
}
