import { PenTool } from 'lucide-react'

export const APP_NAME = 'Design Canvas'

/** Znak marki + nazwa. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden>
        <PenTool strokeWidth={2} />
      </span>
      {compact ? null : <span>{APP_NAME}</span>}
    </span>
  )
}
