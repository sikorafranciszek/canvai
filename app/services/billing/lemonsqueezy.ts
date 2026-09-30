import { createHmac, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { lemonSqueezy, products, type Product, type ProductId } from '#config/billing'
import Subscription, { type SubscriptionStatus } from '#models/subscription'
import User from '#models/user'
import { grantCredits, revokeGrant } from '#services/billing/credits'

/**
 * Lemon Squeezy (Merchant of Record — rozlicza VAT za nas).
 *
 * - Checkout: tworzony przez API z `custom.user_id`, który wraca w każdym webhooku.
 * - Webhooki: podpis HMAC-SHA256 surowego ciała w nagłówku `X-Signature`.
 *   Obsługa jest idempotentna — kredyty mają klucze `ls-order:<id>` /
 *   `ls-invoice:<id>`, subskrypcja jest upsertowana po id.
 */

export class LemonSqueezyError extends Error {}

type JsonApi<T> = { data: { id: string; type: string; attributes: T } }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!lemonSqueezy.apiKey) throw new LemonSqueezyError('Lemon Squeezy API key missing')
  const res = await fetch(`${lemonSqueezy.apiUrl}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': `Bearer ${lemonSqueezy.apiKey}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    // Treść błędu LS bywa długa — do logu skrót, klucz nigdy nie trafia do komunikatu.
    const body = (await res.text()).slice(0, 500)
    logger.error({ status: res.status, body }, 'Lemon Squeezy API error')
    throw new LemonSqueezyError(`Lemon Squeezy API ${res.status}`)
  }
  return (await res.json()) as T
}

/** Tworzy checkout dla produktu i zwraca jego URL. */
export async function createCheckout(
  user: User,
  product: Product,
  redirectUrl: string
): Promise<string> {
  if (!product.variantId || !lemonSqueezy.storeId) {
    throw new LemonSqueezyError(`Product ${product.id} is not configured`)
  }
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: user.email,
          name: user.fullName ?? undefined,
          custom: { user_id: String(user.id), product_id: product.id },
        },
        product_options: {
          redirect_url: redirectUrl,
          enabled_variants: [Number(product.variantId)],
        },
        checkout_options: { embed: false },
        test_mode: lemonSqueezy.testMode || undefined,
      },
      relationships: {
        store: { data: { type: 'stores', id: String(lemonSqueezy.storeId) } },
        variant: { data: { type: 'variants', id: String(product.variantId) } },
      },
    },
  }
  const res = await api<JsonApi<{ url: string }>>('/checkouts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.data.attributes.url
}

interface SubscriptionAttributes {
  customer_id: number | string
  variant_id: number | string
  status: SubscriptionStatus
  renews_at: string | null
  ends_at: string | null
  user_email?: string
  urls?: { customer_portal?: string; update_payment_method?: string }
}

/** Świeży, podpisany link do portalu klienta (ważny krótko — pobieramy przy kliknięciu). */
export async function customerPortalUrl(subscriptionId: string): Promise<string | null> {
  const res = await api<JsonApi<SubscriptionAttributes>>(`/subscriptions/${subscriptionId}`)
  return res.data.attributes.urls?.customer_portal ?? null
}

/** Weryfikacja podpisu webhooka (stały czas porównania). */
export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!lemonSqueezy.webhookSecret || !signature) return false
  const expected = createHmac('sha256', lemonSqueezy.webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function productByVariant(variantId: string | number | null | undefined): Product | null {
  if (variantId == null) return null
  return Object.values(products).find((p) => p.variantId === String(variantId)) ?? null
}

export function productById(id: string): Product | null {
  return (products as Record<string, Product>)[id] ?? null
}

function parseDate(value: string | null | undefined): DateTime | null {
  if (!value) return null
  const dt = DateTime.fromISO(value, { zone: 'utc' })
  return dt.isValid ? dt : null
}

export interface WebhookPayload {
  meta: {
    event_name: string
    custom_data?: { user_id?: string; product_id?: ProductId }
    test_mode?: boolean
  }
  data: { id: string; type: string; attributes: Record<string, any> }
}

async function resolveUser(payload: WebhookPayload): Promise<User | null> {
  const id = Number(payload.meta.custom_data?.user_id)
  if (Number.isInteger(id) && id > 0) {
    const user = await User.find(id)
    if (user) return user
  }
  const email = payload.data.attributes.user_email as string | undefined
  return email ? User.findBy('email', email.toLowerCase()) : null
}

async function upsertSubscription(
  userId: number,
  id: string,
  attrs: SubscriptionAttributes
): Promise<Subscription | null> {
  const product = productByVariant(attrs.variant_id)
  if (!product?.plan) {
    logger.warn({ variant: attrs.variant_id }, 'Lemon Squeezy: subscription with unknown variant')
    return null
  }
  const values = {
    userId,
    provider: 'lemonsqueezy',
    customerId: String(attrs.customer_id),
    variantId: String(attrs.variant_id),
    plan: product.plan,
    status: attrs.status,
    renewsAt: parseDate(attrs.renews_at),
    endsAt: parseDate(attrs.ends_at),
  }
  return Subscription.updateOrCreate({ externalId: String(id) }, values)
}

export type WebhookOutcome = 'processed' | 'ignored'

/** Obsługa zdarzenia (po weryfikacji podpisu). */
export async function handleWebhook(payload: WebhookPayload): Promise<WebhookOutcome> {
  const event = payload.meta.event_name
  const { id, attributes: attrs } = payload.data
  const user = await resolveUser(payload)
  if (!user) {
    logger.warn({ event, id }, 'Lemon Squeezy webhook: user not found')
    return 'ignored'
  }

  switch (event) {
    // Pakiet kredytów (płatność jednorazowa). Zamówienia subskrypcji pomijamy —
    // ich kredyty przychodzą z `subscription_payment_success`.
    case 'order_created': {
      const product = productByVariant(attrs.first_order_item?.variant_id)
      if (!product || product.kind !== 'pack' || attrs.status !== 'paid') return 'ignored'
      await grantCredits(user.id, {
        source: 'pack',
        amount: product.credits,
        expiresAt: DateTime.utc().plus({ months: product.validMonths }),
        externalId: `ls-order:${id}`,
        note: product.id,
      })
      return 'processed'
    }

    case 'order_refunded': {
      await revokeGrant(`ls-order:${id}`, 'order refunded')
      return 'processed'
    }

    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_cancelled':
    case 'subscription_resumed':
    case 'subscription_expired':
    case 'subscription_paused':
    case 'subscription_unpaused': {
      await upsertSubscription(user.id, id, attrs as SubscriptionAttributes)
      return 'processed'
    }

    // Opłacony okres subskrypcji (pierwszy i każdy kolejny) → kredyty planu.
    case 'subscription_payment_success': {
      if (attrs.status && attrs.status !== 'paid') return 'ignored'
      const subscriptionId = String(attrs.subscription_id)
      let sub = await Subscription.findBy('external_id', subscriptionId)
      if (!sub && lemonSqueezy.apiKey) {
        // Zdarzenia przychodzą równolegle — subskrypcji może jeszcze nie być u nas.
        const fresh = await api<JsonApi<SubscriptionAttributes>>(`/subscriptions/${subscriptionId}`)
        sub = await upsertSubscription(user.id, subscriptionId, fresh.data.attributes)
      }
      const product = sub ? productByVariant(sub.variantId) : null
      if (!product) return 'ignored'
      await grantCredits(user.id, {
        source: 'subscription',
        amount: product.credits,
        expiresAt: DateTime.utc().plus({ months: product.validMonths }),
        externalId: `ls-invoice:${id}`,
        note: product.id,
      })
      return 'processed'
    }

    case 'subscription_payment_refunded': {
      await revokeGrant(`ls-invoice:${id}`, 'subscription payment refunded')
      return 'processed'
    }

    default:
      return 'ignored'
  }
}
