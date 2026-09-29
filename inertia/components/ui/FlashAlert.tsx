import { usePage } from '@inertiajs/react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { translateFlash } from '~/lib/format'

/** Komunikaty flash na stronach logowania/konta — w treści, nie jako toast. */
export function FlashAlert() {
  const { flash } = usePage()
  const error = typeof flash.error === 'string' ? translateFlash(flash.error) : null
  const success = typeof flash.success === 'string' ? flash.success : null
  if (!error && !success) return null
  return (
    <div
      className={`alert ${error ? 'alert--danger' : 'alert--notice'}`}
      role={error ? 'alert' : 'status'}
      data-testid={error ? 'flash-error' : 'flash-success'}
    >
      {error ? <AlertCircle /> : <CheckCircle2 />}
      <span>{error ?? success}</span>
    </div>
  )
}
