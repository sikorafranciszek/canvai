import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SceneElement } from '@shared/scene'
import { useSceneStore } from '~/lib/scene/store'

/**
 * Edycja tekstu inline (text / sticky). Overlay HTML textarea — Konva nie ma
 * natywnej edycji tekstu. Zdarzenia klawiatury skierowane na textarea nie
 * łapią skrótów canvasa (skróty sprawdzają fokus).
 *
 * Pole rośnie razem z treścią i można je ręcznie powiększyć (uchwyt w rogu).
 * Nowy rozmiar trafia do elementu: karteczka rośnie, tekst dostaje szerokość
 * zawijania — więcej miejsca do pisania bez wychodzenia z edycji.
 */

const STICKY_PADDING = 12
const TEXT_PADDING_X = 4

export function TextEditor({
  element,
  onCommit,
  onCancel,
}: {
  element: Extract<SceneElement, { type: 'text' | 'sticky' }>
  onCommit: (id: string, text: string, size?: { width?: number; height?: number }) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const camera = useSceneStore((s) => s.camera)
  const initialSize = useRef<{ width: number; height: number } | null>(null)
  const scale = camera.scale

  useEffect(() => {
    // Następna klatka — po zakończeniu zdarzenia, które otworzyło edytor.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  /** Dopasuj wysokość (i dla tekstu szerokość) do treści, nigdy nie zmniejszając poniżej startu. */
  const autoGrow = () => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    const minHeight = initialSize.current?.height ?? 0
    ta.style.height = `${Math.max(minHeight, ta.scrollHeight + 2)}px`
    if (element.type === 'text' && !element.width) {
      ta.style.width = 'auto'
      const minWidth = initialSize.current?.width ?? 0
      ta.style.width = `${Math.max(minWidth, ta.scrollWidth + 4)}px`
    }
  }

  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    initialSize.current = { width: ta.offsetWidth, height: ta.offsetHeight }
    autoGrow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    const ta = ref.current
    if (!ta) return
    const start = initialSize.current
    const size: { width?: number; height?: number } = {}

    if (element.type === 'sticky') {
      // Karteczka przyjmuje rozmiar pola, jeśli treść/użytkownik je powiększył.
      const width = ta.offsetWidth / scale
      const height = ta.offsetHeight / scale
      if (width > element.width + 1) size.width = Math.round(width)
      if (height > element.height + 1) size.height = Math.round(height)
    } else if (start && Math.abs(ta.offsetWidth - start.width) > 2 && element.width !== undefined) {
      size.width = Math.round((ta.offsetWidth - TEXT_PADDING_X * 2) / scale)
    } else if (start && ta.dataset.resized === '1') {
      size.width = Math.round((ta.offsetWidth - TEXT_PADDING_X * 2) / scale)
    }

    onCommit(element.id, ta.value, Object.keys(size).length ? size : undefined)
  }

  // Pozycja world -> screen: screen = world * scale + camera.
  const left = element.x * scale + camera.x
  const top = element.y * scale + camera.y
  const fontSize = element.type === 'sticky' ? (element.fontSize ?? 14) : element.fontSize

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      aria-label={element.type === 'sticky' ? 'Treść karteczki' : 'Treść tekstu'}
      defaultValue={element.text}
      onBlur={commit}
      onInput={autoGrow}
      onMouseUp={() => {
        // Ręczna zmiana rozmiaru uchwytem textarea.
        const ta = ref.current
        const start = initialSize.current
        if (ta && start && (Math.abs(ta.offsetWidth - start.width) > 2 || Math.abs(ta.offsetHeight - start.height) > 2)) {
          ta.dataset.resized = '1'
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        }
      }}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 10,
        margin: 0,
        resize: 'both',
        overflow: 'hidden',
        outline: 'none',
        fontSize: fontSize * scale,
        lineHeight: 1.4,
        fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
        color: element.type === 'text' ? element.fill : '#27251e',
        background: element.type === 'sticky' ? element.fill : 'rgba(253, 251, 250, 0.92)',
        border: '1px solid #016a71',
        boxShadow: '0 0 0 3px rgba(1, 106, 113, 0.22)',
        borderRadius: 6,
        ...(element.type === 'sticky'
          ? {
              width: element.width * scale,
              height: element.height * scale,
              minWidth: element.width * scale,
              minHeight: element.height * scale,
              padding: STICKY_PADDING * scale,
            }
          : {
              width: element.width ? element.width * scale + TEXT_PADDING_X * 2 : undefined,
              minWidth: 120,
              minHeight: fontSize * scale * 1.4 + 6,
              padding: `2px ${TEXT_PADDING_X}px`,
              whiteSpace: element.width ? 'pre-wrap' : 'pre',
            }),
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: 'top left',
      }}
    />
  )
}
