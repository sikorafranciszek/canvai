import { createHmac, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { polar, products, type Product } from '#config/billing'
import Subscription, { type SubscriptionStatus } from '#models/subscription'
import User from '#models/user'
import { grantCredits, revokeGrant } from '#services/billing/credits'
import { track } from '#services/analytics/collector'

/**
 * Polar.sh (Merchant of Record — rozlicza VAT za nas).
 *
 * - Checkout: `POST /v1/checkouts/` z `external_customer_id` = id użytkownika,
 *   więc każdy webhook wskazuje konto przez `customer.external_id`.
 * - Portal klienta: `POST /v1/customer-sessions/` (faktury, karta, anulowanie).
 * - Webhooki: Standard Webhooks (`webhook-id`, `webhook-timestamp`,
 *   `webhook-signature: v1,<base64>`), HMAC-SHA256 z `id.timestamp.body`,
 *   tolerancja 5 min. Klucz: bajty UTF-8 sekretu albo (sekrety od 2026-09-08)
 *   base64 po prefiksie `whsec_` — sprawdzamy oba, jak oficjalne SDK.
 * - Idempotencja: kredyty mają klucze `polar-order:<id>`, subskrypcja jest
 *   upsertowana po id.
 */

export class PolarError extends Error {}

async function api<T>(path: string, body: unknown): Promise<T> {
  if (!polar.accessToken) throw new PolarError('Polar access token missing')
  const res = await fetch(`${polar.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${polar.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    // Skrót odpowiedzi do logu — token nigdy nie trafia do komunikatu.
    logger.error({ status: res.status, body: (await res.text()).slice(0, 500) }, 'Polar API error')
    throw new PolarError(`Polar API ${res.status}`)
  }
  return (await res.json()) as T
}

/**
 * NIP / numer VAT UE do Polar: wielkie litery, bez spacji i myślników; sam
 * 10-cyfrowy NIP dostaje prefiks `PL`. `null` = format niepoprawny.
 */
export function normalizeTaxId(raw: string): string | null {
  const id = raw.toUpperCase().replace(/[\s.-]/g, '')
  if (/^\d{10}$/.test(id)) return `PL${id}`
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(id) ? id : null
}

export interface CheckoutBusiness {
  company: string
  taxId: string
}

/**
 * Tworzy sesję checkoutu dla produktu i zwraca jej URL. Zakup firmowy: Polar
 * zbiera nazwę firmy, adres i NIP, nalicza VAT (odwrotne obciążenie w UE)
 * i wystawia fakturę dostępną w portalu klienta.
 */
export async function createCheckout(
  user: User,
  product: Product,
  successUrl: string,
  business?: CheckoutBusiness | null
): Promise<string> {
  if (!product.polarProductId) throw new PolarError(`Product ${product.id} is not configured`)
  const res = await api<{ url: string }>('/v1/checkouts/', {
    products: [product.polarProductId],
    customer_email: user.email,
    customer_name: business?.company ?? user.fullName ?? undefined,
    external_customer_id: String(user.id),
    metadata: { user_id: String(user.id), product: product.id },
    success_url: successUrl,
    ...(business
      ? {
          is_business_customer: true,
          require_billing_address: true,
          customer_tax_id: business.taxId,
        }
      : {}),
  })
  return res.url
}

/** Link do portalu klienta Polar (faktury, metoda płatności, anulowanie). */
export async function customerPortalUrl(user: User, returnUrl: string): Promise<string | null> {
  const res = await api<{ customer_portal_url?: string }>('/v1/customer-sessions/', {
    external_customer_id: String(user.id),
    return_url: returnUrl,
  })
  return res.customer_portal_url ?? null
}

// ---------------------------------------------------------------------------
// Webhooki
// ---------------------------------------------------------------------------

const TOLERANCE_SECONDS = 300

function signingKeys(secret: string): Buffer[] {
  const utf8 = Buffer.from(secret, 'utf8')
  const keys = [utf8]
  const remainder = secret.startsWith('whsec_') ? secret.slice(6) : secret
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(remainder)) {
    const decoded = Buffer.from(remainder, 'base64')
    if (decoded.length > 0 && !decoded.equals(utf8)) keys.push(decoded)
  }
  return keys
}

export interface WebhookHeaders {
  id?: string
  timestamp?: string
  signature?: string
}

/** Weryfikacja Standard Webhooks (stały czas porównania, okno czasowe 5 min). */
export function verifyWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  nowSeconds = Date.now() / 1000
): boolean {
  const secret = polar.webhookSecret
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS)
    return false

  const signed = `${headers.id}.${Math.floor(timestamp)}.${rawBody}`
  const expected = signingKeys(secret).map((key) =>
    createHmac('sha256', key).update(signed).digest()
  )
  for (const part of headers.signature.split(' ')) {
    const [version, signature] = part.split(',', 2)
    if (version !== 'v1' || !signature) continue
    const given = Buffer.from(signature, 'base64')
    if (expected.some((e) => e.length === given.length && timingSafeEqual(e, given))) return true
  }
  return false
}

export function productByPolarId(id: string | null | undefined): Product | null {
  if (!id) return null
  return Object.values(products).find((p) => p.polarProductId === id) ?? null
}

export function productById(id: string): Product | null {
  return (products as Record<string, Product>)[id] ?? null
}

function parseDate(value: unknown): DateTime | null {
  if (typeof value !== 'string' || !value) return null
  const dt = DateTime.fromISO(value, { zone: 'utc' })
  return dt.isValid ? dt : null
}

export interface WebhookPayload {
  type: string
  timestamp?: string
  data: Record<string, any>
}

async function resolveUser(data: Record<string, any>): Promise<User | null> {
  const candidates = [data.customer?.external_id, data.metadata?.user_id]
  for (const value of candidates) {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0) {
      const user = await User.find(id)
      if (user) return user
    }
  }
  const email = (data.customer?.email ?? data.customer_email) as string | undefined
  return email ? User.findBy('email', email.toLowerCase()) : null
}

/** Upsert subskrypcji z danych Polar (`subscription.*`). */
async function upsertSubscription(userId: number, data: Record<string, any>) {
  const product = productByPolarId(data.product_id)
  if (!product?.plan) {
    logger.warn({ product: data.product_id }, 'Polar: subscription with unknown product')
    return null
  }
  const periodEnd = parseDate(data.current_period_end)
  const endsAt =
    parseDate(data.ended_at) ??
    parseDate(data.ends_at) ??
    (data.cancel_at_period_end ? periodEnd : null)
  return Subscription.updateOrCreate(
    { externalId: String(data.id) },
    {
      userId,
      provider: 'polar',
      customerId: data.customer_id ? String(data.customer_id) : null,
      productId: String(data.product_id),
      plan: product.plan,
      status: data.status as SubscriptionStatus,
      renewsAt: data.cancel_at_period_end ? null : periodEnd,
      endsAt,
    }
  )
}

export type WebhookOutcome = 'processed' | 'ignored'

/** Obsługa zdarzenia Polar (po weryfikacji podpisu). */
export async function handleWebhook(payload: WebhookPayload): Promise<WebhookOutcome> {
  const { type, data } = payload
  const user = await resolveUser(data)
  if (!user) {
    logger.warn({ type, id: data?.id }, 'Polar webhook: user not found')
    return 'ignored'
  }

  switch (type) {
    // Opłacone zamówienie: pakiet kredytów albo okres subskrypcji (pierwszy i kolejne).
    case 'order.paid': {
      if (data.status && data.status !== 'paid') return 'ignored'
      const product = productByPolarId(data.product_id ?? data.product?.id)
      if (!product) return 'ignored'
      if (product.kind === 'subscription') {
        if (!['subscription_create', 'subscription_cycle'].includes(data.billing_reason))
          return 'ignored'
        // Zdarzenia przychodzą równolegle — subskrypcji może jeszcze nie być u nas.
        if (
          data.subscription_id &&
          !(await Subscription.findBy('external_id', String(data.subscription_id)))
        ) {
          await upsertSubscription(user.id, {
            ...(data.subscription ?? {}),
            id: data.subscription_id,
            product_id: product.polarProductId,
            status: data.subscription?.status ?? 'active',
          })
        }
      }
      const granted = await grantCredits(user.id, {
        source: product.kind === 'pack' ? 'pack' : 'subscription',
        amount: product.credits,
        expiresAt: DateTime.utc().plus({ months: product.validMonths }),
        externalId: `polar-order:${data.id}`,
        note: product.id,
      })
      if (granted) {
        track(
          'purchase',
          {
            product: product.id,
            kind: product.kind,
            credits: product.credits,
            amountCents: Number(data.total_amount ?? data.net_amount ?? 0),
            currency: data.currency ?? '',
            billingReason: data.billing_reason ?? 'purchase',
            orderId: String(data.id),
          },
          { userId: user.id }
        )
      }
      return 'processed'
    }

    // Pełny zwrot zamówienia cofa niewykorzystane kredyty z tego zamówienia.
    case 'order.refunded': {
      if (data.status && data.status !== 'refunded') return 'ignored'
      if (await revokeGrant(`polar-order:${data.id}`, 'order refunded')) {
        track('refund', { orderId: String(data.id) }, { userId: user.id })
      }
      return 'processed'
    }

    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.active':
    case 'subscription.canceled':
    case 'subscription.uncanceled':
    case 'subscription.revoked':
    case 'subscription.past_due':
    case 'subscription.paused':
    case 'subscription.resumed': {
      const sub = await upsertSubscription(user.id, data)
      if (sub)
        track(
          'subscription_changed',
          { type, status: sub.status, plan: sub.plan },
          { userId: user.id }
        )
      return 'processed'
    }

    default:
      return 'ignored'
  }
}
