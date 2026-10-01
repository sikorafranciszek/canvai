import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import vine from '@vinejs/vine'
import {
  billing,
  checkoutReady,
  costs,
  freeCredits,
  plans,
  products,
  type ProductId,
} from '#config/billing'
import Board from '#models/board'
import CreditTransaction from '#models/credit_transaction'
import Subscription from '#models/subscription'
import { absoluteUrl } from '#services/app_url'
import { balanceOf, ensureAutomaticGrants, nextExpiry } from '#services/billing/credits'
import { createCheckout, customerPortalUrl, productById } from '#services/billing/polar'
import CreditGrant from '#models/credit_grant'
import { entitlementsFor } from '#services/billing/plans'
import { t } from '#services/i18n'
import { referralCodeFor, referralStats } from '#services/billing/referrals'
import { trackFor } from '#services/analytics/events'

const checkoutValidator = vine.compile(
  vine.object({
    product: vine.enum(Object.keys(products) as ProductId[]),
  })
)

/** Nieskończoność nie przechodzi przez JSON — do UI jako `null` (= bez limitu). */
function finite(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : value
}

async function activeSubscription(userId: number) {
  const subs = await Subscription.query().where('user_id', userId).orderBy('id', 'desc')
  return subs.find((s) => s.grantsAccess) ?? null
}

async function summary(userId: number) {
  await ensureAutomaticGrants(userId)
  const { plan, limits } = await entitlementsFor(userId)
  return {
    plan,
    balance: await balanceOf(userId),
    enforced: billing.enforced,
    limits: {
      ...limits,
      boards: finite(limits.boards),
      materialsPerBoard: finite(limits.materialsPerBoard),
      collaborators: finite(limits.collaborators),
    },
  }
}

/**
 * Rozliczenia: strona planu i kredytów, checkout Polar.sh, portal klienta.
 */
export default class BillingController {
  /** GET /billing */
  async show(ctx: HttpContext) {
    const { auth, inertia, request } = ctx
    const user = auth.user!
    const [code, stats] = [await referralCodeFor(user), await referralStats(user.id)]
    const [base, sub, expiry, boards, history] = await Promise.all([
      summary(user.id),
      activeSubscription(user.id),
      nextExpiry(user.id),
      Board.query().where('user_id', user.id).where('is_sample', false).count('* as total'),
      CreditTransaction.query().where('user_id', user.id).orderBy('id', 'desc').limit(30),
    ])

    return inertia.render(
      'billing/index' as any,
      {
        billing: {
          ...base,
          nextExpiry: expiry,
          boardsUsed: Number(boards[0].$extras.total),
          subscription: sub
            ? {
                plan: sub.plan,
                status: sub.status,
                renewsAt: sub.renewsAt?.toISO() ?? null,
                endsAt: sub.endsAt?.toISO() ?? null,
              }
            : null,
          referral: { url: absoluteUrl(ctx, `/signup?ref=${code}`), ...stats },
          checkoutReady: checkoutReady(),
          hasPurchases: Boolean(sub) || base.plan !== 'free',
          justPurchased: request.qs().checkout === 'success',
          costs,
          freeCredits,
          plans: Object.fromEntries(
            Object.entries(plans).map(([id, l]) => [
              id,
              { ...l, boards: finite(l.boards), materialsPerBoard: finite(l.materialsPerBoard) },
            ])
          ),
          products: Object.values(products).map((p) => ({
            id: p.id,
            kind: p.kind,
            credits: p.credits,
            price: p.price,
            plan: p.plan ?? null,
            validMonths: p.validMonths,
            available: Boolean(p.polarProductId) && checkoutReady(),
          })),
          // Dziennik: przyznania i rozliczone generacje (rezerwacja + ewentualny zwrot).
          history: history.map((h) => ({
            id: h.id,
            kind: h.kind,
            amount: h.amount,
            note: h.note,
            designDocId: h.designDocId,
            createdAt: h.createdAt?.toISO() ?? null,
          })),
        },
      } as any
    )
  }

  /** GET /api/billing — saldo i plan (pasek boczny, panel DESIGN.md). */
  async summary({ auth, response }: HttpContext) {
    return response.json({ data: await summary(auth.user!.id) })
  }

  /** POST /billing/checkout — przekierowanie do checkoutu Polar. */
  async checkout(ctx: HttpContext) {
    const { auth, request, inertia, session, response } = ctx
    const user = auth.user!
    const { product: productId } = await request.validateUsing(checkoutValidator)
    const product = productById(productId)

    if (!product?.polarProductId || !checkoutReady()) {
      session.flash('error', t('billing.checkoutUnavailable'))
      return response.redirect().toPath('/billing')
    }
    if (product.kind === 'subscription' && (await activeSubscription(user.id))) {
      session.flash('error', t('billing.alreadySubscribed'))
      return response.redirect().toPath('/billing')
    }

    try {
      const url = await createCheckout(user, product, absoluteUrl(ctx, '/billing?checkout=success'))
      trackFor(ctx, 'checkout_started', { product: product.id, kind: product.kind })
      return inertia.location(url)
    } catch (error) {
      logger.error({ err: error, product: product.id }, 'checkout failed')
      session.flash('error', t('billing.checkoutFailed'))
      return response.redirect().toPath('/billing')
    }
  }

  /** GET /billing/portal — portal klienta Polar (faktury, karta, anulowanie subskrypcji). */
  async portal(ctx: HttpContext) {
    const { auth, session, response } = ctx
    const user = auth.user!
    const [sub, pack] = await Promise.all([
      Subscription.query().where('user_id', user.id).first(),
      CreditGrant.query().where('user_id', user.id).where('source', 'pack').first(),
    ])
    if (!sub && !pack) {
      session.flash('error', t('billing.noSubscription'))
      return response.redirect().toPath('/billing')
    }
    try {
      const url = await customerPortalUrl(user, absoluteUrl(ctx, '/billing'))
      if (url) return response.redirect(url)
    } catch (error) {
      logger.error({ err: error }, 'customer portal failed')
    }
    session.flash('error', t('billing.portalFailed'))
    return response.redirect().toPath('/billing')
  }
}
