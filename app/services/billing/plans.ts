import { billing, plans, type PlanId, type PlanLimits } from '#config/billing'
import CreditGrant from '#models/credit_grant'
import Subscription from '#models/subscription'

/**
 * Plan użytkownika wynika ze stanu, nie z flagi w koncie:
 * aktywna subskrypcja → jej plan; kiedykolwiek kupiony pakiet → Pay as you go;
 * w przeciwnym razie Free.
 */
export async function planFor(userId: number): Promise<PlanId> {
  const subs = await Subscription.query().where('user_id', userId).orderBy('id', 'desc')
  const active = subs.find((s) => s.grantsAccess)
  if (active) return active.plan

  const pack = await CreditGrant.query()
    .where('user_id', userId)
    .where('source', 'pack')
    .whereNull('revoked_at')
    .first()
  return pack ? 'payg' : 'free'
}

/** Bez egzekwowania (self-hosting, testy) — wszystko odblokowane. */
const UNLIMITED: PlanLimits = {
  boards: null,
  materialsPerBoard: Number.POSITIVE_INFINITY,
  versionsKept: null,
  watermark: false,
  exports: true,
  proReasoning: true,
  api: true,
  portal: true,
  brandKits: true,
  collaborators: Number.POSITIVE_INFINITY,
}

export async function entitlementsFor(
  userId: number
): Promise<{ plan: PlanId; limits: PlanLimits }> {
  const plan = await planFor(userId)
  return { plan, limits: billing.enforced ? plans[plan] : UNLIMITED }
}
