/**
 * Komunikaty błędów z następnym krokiem (UX-3). Zamiast surowego „HTTP 500”
 * użytkownik dostaje informację, co się stało i co może zrobić — a przy
 * limitach planu przycisk przejścia do rozliczeń.
 */
import { router } from '@inertiajs/react'
import { toast } from 'sonner'
import { translate, type MessageKey } from '~/i18n'

/** Błąd żądania HTTP: status, kod serwera i komunikat (jeśli serwer go podał). */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
    /** Komunikat pochodzi z serwera (a nie z ogólnego fallbacku). */
    public readonly fromServer = false
  ) {
    super(message)
  }
}

/** Tworzy HttpError z odpowiedzi (`message` albo pierwszy błąd walidacji). */
export async function httpError(res: Response, fallback: string): Promise<HttpError> {
  let message: string | null = null
  let code: string | null = null
  try {
    const body = JSON.parse(await res.text()) as {
      message?: unknown
      code?: unknown
      errors?: { message?: unknown }[]
    }
    if (typeof body?.message === 'string' && body.message) message = body.message
    else if (typeof body?.errors?.[0]?.message === 'string') message = body.errors[0].message
    if (typeof body?.code === 'string') code = body.code
  } catch {
    // odpowiedź nie jest JSON — zostaje fallback
  }
  return new HttpError(message ?? fallback, res.status, code, message != null)
}

interface Described {
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

const GENERIC = /^(HTTP \d{3}|Failed to fetch|NetworkError|Load failed)/i

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status
  // fetch() odrzuca TypeError przy braku sieci.
  if (error instanceof TypeError) return 0
  return null
}

function serverMessage(error: unknown): string | null {
  if (error instanceof HttpError) return error.fromServer ? error.message : null
  if (error instanceof Error && error.message && !GENERIC.test(error.message)) return error.message
  return null
}

const toBilling = (key: MessageKey) => ({
  label: translate(key),
  onClick: () => router.visit('/billing'),
})
const reload = () => ({
  label: translate('error.500.reload'),
  onClick: () => window.location.reload(),
})

/** Komunikat i akcja dla błędu; `fallback` — gdy nic konkretniejszego nie wiemy. */
export function describeError(error: unknown, fallback: MessageKey): Described {
  const status = statusOf(error)
  const fromServer = serverMessage(error)
  const code = (error as { code?: unknown } | null)?.code

  if (status === 0) return { message: translate('errors.network') }
  if (status === 401 || status === 419) {
    return { message: translate('errors.session'), action: reload(), duration: 10_000 }
  }
  if (status === 402) {
    return {
      message: fromServer ?? translate('errors.credits'),
      action: toBilling(
        typeof code === 'string' && code.startsWith('E_PLAN') ? 'billing.upgrade' : 'billing.topUp'
      ),
      duration: 8000,
    }
  }
  if (status === 403) {
    const plan = typeof code === 'string' && code.startsWith('E_PLAN')
    return {
      message: fromServer ?? translate('errors.forbidden'),
      ...(plan ? { action: toBilling('billing.upgrade'), duration: 8000 } : {}),
    }
  }
  if (status === 404) return { message: translate('errors.notFound'), action: reload() }
  if (status === 413) return { message: translate('errors.tooLarge') }
  if (status === 429)
    return { message: fromServer ?? translate('errors.rateLimited'), duration: 8000 }
  if (status === 503)
    return { message: fromServer ?? translate('errors.unavailable'), duration: 8000 }
  if (status != null && status >= 500)
    return { message: translate('errors.server'), duration: 8000 }
  return { message: fromServer ?? translate(fallback) }
}

/** Toast z komunikatem błędu (i akcją, jeśli ma sens). */
export function notifyError(error: unknown, fallback: MessageKey): void {
  const { message, action, duration } = describeError(error, fallback)
  toast.error(message, { ...(action ? { action } : {}), ...(duration ? { duration } : {}) })
}
