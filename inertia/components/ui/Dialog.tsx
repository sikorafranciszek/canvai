/**
 * Dialog na natywnym `<dialog>` (showModal): fokus uwięziony w oknie, Esc
 * zamyka, tło blokuje interakcję — bez własnej implementacji focus-trapu.
 */
import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  testId?: string
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  testId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="modal"
      data-testid={testId}
      aria-labelledby={testId ? `${testId}-title` : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Klik w tło (poza treścią okna) zamyka dialog.
        if (e.target === ref.current) onClose()
      }}
    >
      {open ? (
        <>
          <div className="modal__body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 className="modal__title" id={testId ? `${testId}-title` : undefined}>
                {title}
              </h2>
              {description ? <div className="t-muted">{description}</div> : null}
            </div>
            {children}
          </div>
          {footer ? <div className="modal__footer">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  )
}
