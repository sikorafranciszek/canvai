import { useEffect, useRef } from 'react'
import type { SceneElement } from '@shared/scene'
import { useSceneStore } from '~/lib/scene/store'

/**
 * Edycja tekstu inline (text / sticky). Overlay HTML textarea — Konva nie ma
 * natywnej edycji tekstu. Zdarzenia klawiatury skierowane na textarea nie
 * łapią skrótów canvasa (skróty sprawdzają fokus).
 */
export function TextEditor({
  element,
  onCommit,
  onCancel,
}: {
  element: Extract<SceneElement, { type: 'text' | 'sticky' }>
  onCommit: (id: string, text: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const camera = useSceneStore((s) => s.camera)

  useEffect(() => {
    // Następna klatka — po zakończeniu zdarzenia, które otworzyło edytor.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const commit = () => {
    const value = ref.current?.value
    if (value !== undefined) onCommit(element.id, value)
  }

  // Pozycja world -> screen: screen = world * scale + camera.
  const left = element.x * camera.scale + camera.x
  const top = element.y * camera.scale + camera.y
  const fontSize = element.type === 'sticky' ? (element.fontSize ?? 14) : element.fontSize

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      defaultValue={element.type === 'sticky' ? element.text : element.text}
      onBlur={commit}
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
        resize: 'none',
        outline: 'none',
        fontSize: fontSize * camera.scale,
        lineHeight: 1.4,
        fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
        color: element.type === 'text' ? element.fill : '#27251e',
        background: element.type === 'sticky' ? element.fill : 'rgba(253, 251, 250, 0.9)',
        border: '1px solid #016a71',
        boxShadow: '0 0 0 3px rgba(1, 106, 113, 0.22)',
        borderRadius: 6,
        ...(element.type === 'sticky'
          ? {
              width: element.width * camera.scale,
              height: element.height * camera.scale,
              padding: 12 * camera.scale,
            }
          : { minWidth: 160, minHeight: fontSize * camera.scale * 1.6, padding: '2px 4px' }),
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: 'top left',
      }}
    />
  )
}
