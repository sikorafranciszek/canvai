/**
 * Proste menu rozwijane: przycisk-wyzwalacz + lista akcji. Zamyka się po
 * kliknięciu poza menu, Esc i po wybraniu akcji. Strzałki przesuwają fokus.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface MenuAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  testId?: string
}

interface MenuProps {
  actions: MenuAction[]
  label: string
  align?: 'left' | 'right'
  testId?: string
}

export function Menu({ actions, label, align = 'right', testId }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Fokus na pierwszą pozycję po otwarciu.
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn--quiet btn--icon btn--sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreHorizontal />
      </button>
      {open ? (
        <div
          className="menu"
          role="menu"
          onKeyDown={onMenuKey}
          style={{ top: 'calc(100% + 4px)', [align]: 0 }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              data-testid={action.testId}
              className={`menu__item${action.danger ? ' menu__item--danger' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
