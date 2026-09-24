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
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    const value = ref.current?.value
    if (value !== undefined) onCommit(element.id, value)
  }

  // Pozycja world -> screen: screen = world * scale + camera.
  const left = element.x * camera.scale + camera.x
  const top = element.y * camera.scale + camera.y
  const fontSize = element.type === 'sticky' ? element.fontSize ?? 14 : element.fontSize

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
        minWidth: 160,
        minHeight: 40,
        fontSize,
        fontFamily: 'Inter, sans-serif',
        background: element.type === 'sticky' ? '#fef9c3' : 'transparent',
        border: '1px solid #3b82f6',
        borderRadius: 4,
        padding: 4,
        resize: 'none',
        zIndex: 10,
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: 'top left',
      }}
    />
  )
}
