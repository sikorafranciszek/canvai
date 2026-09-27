import { useCallback, useEffect, useRef, useState } from 'react'
import { Arrow, Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { SceneDocument, SceneElement, ScenePoint } from '@shared/scene'
import { useSceneStore, createElementForTool, type Tool } from '~/lib/scene/store'
import { getElementBounds, screenToWorld } from '~/lib/scene/geometry'
import { isHttpUrl } from '@shared/asset-utils'
import { createElementId } from '@shared/scene-ops'
import { parseClipboardElements, prepareElementsForPaste, serializeElements } from '@shared/clipboard'
import { useBoardStore } from '~/lib/board/session'
import { SceneElementNode } from './SceneElementNode'
import { TextEditor } from './TextEditor'

const MIN_SCALE = 0.1
const MAX_SCALE = 8

export function Canvas({ boardId }: { boardId: number }) {
  const document = useSceneStore((s) => s.document)
  const selection = useSceneStore((s) => s.selection)
  const tool = useSceneStore((s) => s.tool)
  const camera = useSceneStore((s) => s.camera)
  const pendingUploads = useBoardStore((s) => s.pendingUploads)

  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef(new Map<string, Konva.Node>())
  const isSpaceDown = useRef(false)
  const spacePreviousTool = useRef<Tool>('select')

  const [draft, setDraft] = useState<{ kind: Tool; start: ScenePoint; points: ScenePoint[] } | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isMiddlePan, setIsMiddlePan] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  // Stage ma rozmiar kontenera (a nie całego okna) — po prawej jest panel assetów.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  // Stabilne referencje — kluczowe, żeby memoizacja SceneElementNode działała
  // (bez tego każdy render tworzy nowe funkcje i 500 elementów re-renderuje się całe).
  const handleSelect = useCallback((id: string, additive: boolean) => {
    const store = useSceneStore.getState()
    if (additive) store.toggleSelection(id)
    else store.selectOnly([id])
  }, [])

  const handleDragStart = useCallback(() => {}, [])

  const handleNodeDragEnd = useCallback((id: string, node: Konva.Node) => {
    const store = useSceneStore.getState()
    const baseline = store.document
    const el = baseline.elements.find((e) => e.id === id)
    if (!el) return
    const next = updateElementLive(baseline, id, { x: node.x(), y: node.y() })
    store.commitGesture(baseline, next)
  }, [])

  const handleEdit = useCallback((id: string) => setEditingId(id), [])

  // Podepnij Transformer do zaznaczonych węzłów.
  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const nodes = selection
      .map((id) => nodeRefs.current.get(id))
      .filter((n): n is Konva.Node => Boolean(n))
    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [selection, document])

  // Przechwytuj klawiaturę (poza polami tekstowymi).
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      const store = useSceneStore.getState()
      const mod = e.ctrlKey || e.metaKey

      if (e.code === 'Space') {
        e.preventDefault()
        if (!isSpaceDown.current) {
          spacePreviousTool.current = store.tool
          store.setTool('pan')
          isSpaceDown.current = true
        }
        return
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        store.selectAll()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        store.duplicateSelection()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        store.deleteSelection()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        store.clearSelection()
        setDraft(null)
        setMarquee(null)
        setEditingId(null)
        return
      }
      const step = e.shiftKey ? 10 : 1
      if (e.key === 'ArrowLeft') { e.preventDefault(); store.moveSelection(-step, 0) }
      if (e.key === 'ArrowRight') { e.preventDefault(); store.moveSelection(step, 0) }
      if (e.key === 'ArrowUp') { e.preventDefault(); store.moveSelection(0, -step) }
      if (e.key === 'ArrowDown') { e.preventDefault(); store.moveSelection(0, step) }
      if (e.key === ']') { e.preventDefault(); store.reorderSelection('forward') }
      if (e.key === '[') { e.preventDefault(); store.reorderSelection('backward') }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isSpaceDown.current) {
        isSpaceDown.current = false
        useSceneStore.getState().setTool(spacePreviousTool.current)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const getWorldPointer = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const p = stage.getRelativePointerPosition()
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }
  }, [])

  // Wczytanie sceny + autosave + zapis przy beforeunload.
  useEffect(() => {
    const session = useBoardStore.getState()
    void session.init(boardId)
    return () => session.dispose()
  }, [boardId])

  useEffect(() => {
    const onBeforeUnload = () => {
      void useBoardStore.getState().saveNow({ keepalive: true })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Wklejanie (Ctrl+V) ze schowka systemowego — obraz lub tekst (URL/notatka).
  // Działa przy fokusie na płótnie i na stronie, ale NIE w polach tekstowych.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      const point = getWorldPointer()
      const items = e.clipboardData?.items
      if (items) {
        for (const item of Array.from(items)) {
          if (item.kind === 'file') {
            const file = item.getAsFile()
            if (file) {
              e.preventDefault()
              void useBoardStore.getState().uploadFiles([file], 'paste', point)
              return
            }
          }
        }
      }

      const text = e.clipboardData?.getData('text/plain')
      if (!text) return

      // Elementy sceny (kopia z Ctrl+C) — payload w schowku systemowym.
      const elements = parseClipboardElements(text)
      if (elements) {
        e.preventDefault()
        const clones = prepareElementsForPaste(elements, createElementId)
        const store = useSceneStore.getState()
        for (const clone of clones) store.addElement(clone)
        return
      }

      const trimmed = text.trim()
      if (!trimmed) return
      e.preventDefault()
      if (isHttpUrl(trimmed)) {
        void useBoardStore.getState().addLink(trimmed, point)
      } else {
        useBoardStore.getState().addTextNote(text, point)
      }
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [getWorldPointer])

  // Kopiowanie/wycinanie elementów sceny przez schowek SYSTEMOWY (zdarzenia
  // `copy`/`cut`), żeby Ctrl+V obsługiwał JEDEN punkt wejścia — event `paste`.
  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    }

    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const { document, selection } = useSceneStore.getState()
      if (selection.length === 0) return
      const elements = document.elements.filter((el) => selection.includes(el.id))
      e.preventDefault()
      e.clipboardData?.setData('text/plain', serializeElements(elements))
    }

    const onCut = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const { document, selection } = useSceneStore.getState()
      if (selection.length === 0) return
      const elements = document.elements.filter((el) => selection.includes(el.id))
      e.preventDefault()
      e.clipboardData?.setData('text/plain', serializeElements(elements))
      useSceneStore.getState().deleteSelection()
    }

    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
    }
  }, [])

  const handleStageMouseDown = (e: any) => {
    if (e.evt.button === 1) return // środkowy przycisk = pan (obsłużone niżej)

    const point = getWorldPointer()

    if (tool === 'select') {
      const clickedEmpty = e.target === e.target.getStage()
      if (clickedEmpty) {
        setMarquee({ x: point.x, y: point.y, width: 0, height: 0 })
      }
      return
    }

    if (tool === 'pan') return

    if (tool === 'text' || tool === 'sticky') {
      useSceneStore.getState().addElement(createElementForTool(tool, point.x, point.y))
      return
    }

    setDraft({ kind: tool, start: point, points: [point] })
  }

  const handleStageMouseMove = () => {
    if (!draft && !marquee) return
    const point = getWorldPointer()

    if (marquee) {
      setMarquee((m) => {
        if (!m) return m
        return {
          x: Math.min(m.x, point.x),
          y: Math.min(m.y, point.y),
          width: Math.abs(point.x - m.x),
          height: Math.abs(point.y - m.y),
        }
      })
      return
    }

    if (draft) {
      if (draft.kind === 'freehand') {
        const last = draft.points[draft.points.length - 1]
        const dx = point.x - last.x
        const dy = point.y - last.y
        if (dx * dx + dy * dy > 4) setDraft({ ...draft, points: [...draft.points, point] })
      } else {
        setDraft({ ...draft, points: [draft.start, point] })
      }
    }
  }

  const handleStageMouseUp = () => {
    if (draft) {
      commitDraft(draft)
      setDraft(null)
    }
    if (marquee) {
      applyMarquee(marquee)
      setMarquee(null)
    }
  }

  const commitDraft = (d: { kind: Tool; start: ScenePoint; points: ScenePoint[] }) => {
    const store = useSceneStore.getState()
    if (d.kind === 'freehand') {
      const points = d.points.map((p) => ({ x: p.x - d.start.x, y: p.y - d.start.y }))
      if (points.length < 2) return
      const el = { ...createElementForTool('freehand', d.start.x, d.start.y), points } as SceneElement
      store.addElement(el)
      return
    }

    const p0 = d.start
    const p1 = d.points[1] ?? p0
    const width = p1.x - p0.x
    const height = p1.y - p0.y
    if (Math.abs(width) < 3 && Math.abs(height) < 3) return

    if (d.kind === 'rectangle' || d.kind === 'ellipse') {
      const el = createElementForTool(d.kind, Math.min(p0.x, p1.x), Math.min(p0.y, p1.y))
      if (el.type === 'rectangle' || el.type === 'ellipse') {
        el.width = Math.abs(width)
        el.height = Math.abs(height)
      }
      store.addElement(el)
      return
    }

    if (d.kind === 'line' || d.kind === 'arrow') {
      const el = createElementForTool(d.kind, p0.x, p0.y)
      if (el.type === 'line' || el.type === 'arrow') {
        el.points = [
          { x: 0, y: 0 },
          { x: width, y: height },
        ]
      }
      store.addElement(el)
    }
  }

  const applyMarquee = (m: { x: number; y: number; width: number; height: number }) => {
    if (m.width < 3 && m.height < 3) {
      useSceneStore.getState().clearSelection()
      return
    }
    const ids = document.elements
      .filter((el) => {
        const b = getElementBounds(el)
        return b.x < m.x + m.width && b.x + b.width > m.x && b.y < m.y + m.height && b.y + b.height > m.y
      })
      .map((el) => el.id)
    useSceneStore.getState().selectOnly(ids)
  }

  const handleWheel = (e: any) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const scaleBy = 1.05
    const oldScale = camera.scale
    const pointer = stage.getPointerPosition() ?? { x: 0, y: 0 }
    const mousePointTo = {
      x: (pointer.x - camera.x) / oldScale,
      y: (pointer.y - camera.y) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const next = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy
    const scale = clamp(next, MIN_SCALE, MAX_SCALE)
    const x = pointer.x - mousePointTo.x * scale
    const y = pointer.y - mousePointTo.y * scale
    stage.position({ x, y })
    stage.scale({ x: scale, y: scale })
    useSceneStore.getState().setCamera({ x, y, scale })
  }

  // Środkowy przycisk = pan.
  const handleMouseDown = (e: any) => {
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return
      setIsMiddlePan(true)
      stage.draggable(true)
      stage.startDrag(e)
    }
  }

  const handleDragMove = () => {
    const stage = stageRef.current
    if (!stage) return
    useSceneStore.getState().setCamera({ x: stage.x(), y: stage.y(), scale: stage.scaleX() })
  }

  const handleDragEnd = () => {
    const stage = stageRef.current
    if (!stage) return
    const stillPan = useSceneStore.getState().tool === 'pan'
    stage.draggable(stillPan)
    setIsMiddlePan(false)
    useSceneStore.getState().setCamera({ x: stage.x(), y: stage.y(), scale: stage.scaleX() })
  }

  const handleTransformEnd = () => {
    const transformer = transformerRef.current
    if (!transformer) return
    const nodes = transformer.nodes() as Konva.Node[]
    if (nodes.length === 0) return

    const store = useSceneStore.getState()
    const baseline = store.document
    let next = baseline

    for (const node of nodes) {
      const id = node.id()
      const el = baseline.elements.find((e) => e.id === id)
      if (!el) continue

      const scaleX = node.scaleX()
      const scaleY = node.scaleY()
      const patch: Record<string, unknown> = { rotation: node.rotation() }

      if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'sticky' || el.type === 'image') {
        patch.width = Math.max(1, el.width * scaleX)
        patch.height = Math.max(1, el.height * scaleY)
      }

      next = updateElementLive(next, id, patch as Partial<SceneElement>)
      node.scaleX(1)
      node.scaleY(1)
    }

    store.commitGesture(baseline, next)
    transformer.getLayer()?.batchDraw()
  }

  const handleTextCommit = (id: string, text: string) => {
    setEditingId(null)
    const store = useSceneStore.getState()
    const baseline = store.document
    const next = updateElementLive(baseline, id, { text })
    store.commitGesture(baseline, next)
  }

  const stageChildren = document.elements.map((el) => (
    <SceneElementNode
      key={el.id}
      el={el}
      isSelected={selection.includes(el.id)}
      listening={tool === 'select'}
      registerNode={registerNode}
      onSelect={handleSelect}
      onDragStart={handleDragStart}
      onDragEnd={handleNodeDragEnd}
      onEdit={handleEdit}
    />
  ))

  // Drag & drop plików na płótno (wiele naraz, pozycja = miejsce upuszczenia).
  const handleDrop = (e: any) => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragOver(false)
    const files: File[] = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const point = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, camera)
    void useBoardStore.getState().uploadFiles(files, 'drop', point)
  }

  const handleDragEnter = (e: any) => {
    e.preventDefault()
    dragDepth.current += 1
    setIsDragOver(true)
  }

  const handleDragOver = (e: any) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: any) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragOver(false)
    }
  }

  // Fallback: zwykły przycisk uploadu (pozycja = środek widoku).
  const handleUploadInput = (e: any) => {
    const files: File[] = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const vw = Math.max(1, window.innerWidth - 304)
    const vh = Math.max(1, window.innerHeight - 100)
    const point = screenToWorld(vw / 2, vh / 2, camera)
    void useBoardStore.getState().uploadFiles(files, 'upload', point)
    e.target.value = ''
  }

  const selectedElement =
    selection.length === 1 ? document.elements.find((e) => e.id === selection[0]) : undefined

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      data-testid="canvas-root"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={tool === 'pan' || isMiddlePan}
        onMouseDown={(e) => {
          handleStageMouseDown(e)
          handleMouseDown(e)
        }}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onWheel={handleWheel}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        data-testid="canvas-stage"
      >
        {/* Warstwa statyczna: elementy sceny. */}
        <Layer listening={tool === 'select'}>{stageChildren}</Layer>

        {/* Placeholdery uploadu (optymistyczne, z paskiem postępu). */}
        {pendingUploads.length > 0 && (
          <Layer listening={false}>
            {pendingUploads.map((u) => (
              <Group key={u.id} x={u.x} y={u.y} listening={false}>
                <Rect
                  width={u.width}
                  height={u.height}
                  fill="#eef2ff"
                  stroke="#818cf8"
                  strokeWidth={1}
                  dash={[4, 4]}
                  cornerRadius={4}
                />
                <Rect
                  width={Math.max(0, u.width * u.progress)}
                  height={6}
                  x={0}
                  y={u.height - 10}
                  fill="#6366f1"
                />
                <Text
                  text={u.filename}
                  x={8}
                  y={u.height / 2 - 22}
                  width={u.width - 16}
                  fontSize={12}
                  fill="#475569"
                  ellipsis
                  listening={false}
                />
                <Text
                  text={u.status === 'error' ? 'błąd' : `${Math.round(u.progress * 100)}%`}
                  x={8}
                  y={u.height / 2 - 2}
                  width={u.width - 16}
                  fontSize={11}
                  fill="#64748b"
                  listening={false}
                />
              </Group>
            ))}
          </Layer>
        )}

        {/* Warstwa interakcji: draft, marquee, transformer. */}
        <Layer listening={false}>
          {draft && draft.kind !== 'freehand' && draft.points.length === 2 && <DraftShape draft={draft} />}
          {draft && draft.kind === 'freehand' && (
            <Line
              points={draft.points.flatMap((p) => [p.x, p.y])}
              stroke="#7c3aed"
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="#3b82f633"
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
              data-testid="marquee"
            />
          )}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            anchorSize={8}
            borderStroke="#3b82f6"
            anchorStroke="#3b82f6"
            boundBoxFunc={(oldBox, newBox) =>
              Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox
            }
            onTransformEnd={handleTransformEnd}
            listening={selection.length > 0}
          />
        </Layer>
      </Stage>

      {selectedElement &&
        (selectedElement.type === 'text' || selectedElement.type === 'sticky') &&
        editingId === selectedElement.id && (
          <TextEditor element={selectedElement} onCommit={handleTextCommit} onCancel={() => setEditingId(null)} />
        )}

      {/* Podświetlenie strefy upuszczenia. */}
      {isDragOver && (
        <div
          data-testid="drop-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: '#3b82f61a',
            border: '2px dashed #3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: '12px 20px',
              fontSize: 14,
              color: '#1d4ed8',
              fontWeight: 600,
            }}
          >
            Upuść pliki, aby dodać je do tablicy
          </div>
        </div>
      )}

      {/* Empty state — podpowiedź Ctrl+V. */}
      {document.elements.length === 0 && pendingUploads.length === 0 && (
        <div
          data-testid="canvas-empty-state"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <div style={{ textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#334155' }}>Pusta tablica</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              Wklej zrzut ekranu — <b>Ctrl+V</b>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>albo upuść pliki na płótno</div>
          </div>
        </div>
      )}

      {/* Fallback: zwykły przycisk uploadu. */}
      <button
        type="button"
        data-testid="upload-button"
        onClick={() => fileInputRef.current?.click()}
        title="Wgraj pliki"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          padding: '7px 12px',
          borderRadius: 6,
          border: '1px solid #e2e8f0',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 13,
          boxShadow: '0 1px 2px #00000014',
        }}
      >
        ⬆ Wgraj pliki
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"
        style={{ display: 'none' }}
        onChange={handleUploadInput}
        data-testid="upload-input"
      />

      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          fontSize: 12,
          color: '#64748b',
          background: '#ffffffee',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: '2px 8px',
        }}
        data-testid="zoom-indicator"
      >
        {Math.round(camera.scale * 100)}%
      </div>
    </div>
  )
}

function updateElementLive(doc: SceneDocument, id: string, patch: Partial<SceneElement>): SceneDocument {
  return {
    ...doc,
    elements: doc.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as SceneElement) : el)),
  }
}

function DraftShape({ draft }: { draft: { kind: Tool; start: ScenePoint; points: ScenePoint[] } }) {
  const p0 = draft.start
  const p1 = draft.points[1] ?? p0
  const x = Math.min(p0.x, p1.x)
  const y = Math.min(p0.y, p1.y)
  const width = Math.abs(p1.x - p0.x)
  const height = Math.abs(p1.y - p0.y)

  switch (draft.kind) {
    case 'rectangle':
      return <Rect x={x} y={y} width={width} height={height} fill="#3b82f61a" stroke="#3b82f6" strokeWidth={1.5} dash={[4, 4]} listening={false} />
    case 'ellipse':
      return <Ellipse x={x} y={y} width={width} height={height} fill="#3b82f61a" stroke="#3b82f6" strokeWidth={1.5} dash={[4, 4]} listening={false} />
    case 'line':
      return <Line points={[p0.x, p0.y, p1.x, p1.y]} stroke="#3b82f6" strokeWidth={2} listening={false} />
    case 'arrow':
      return <Arrow points={[p0.x, p0.y, p1.x, p1.y]} stroke="#3b82f6" strokeWidth={2} fill="#3b82f6" pointerLength={10} pointerWidth={10} listening={false} />
    default:
      return null
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
