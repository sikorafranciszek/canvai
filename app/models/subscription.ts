import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { PlanId } from '#config/billing'

/** Statusy Lemon Squeezy. */
export type SubscriptionStatus =
  'on_trial' | 'active' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired'

/** Lustro subskrypcji z Lemon Squeezy (aktualizowane webhookami). */
export default class Subscription extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare provider: string

  @column()
  declare externalId: string

  @column()
  declare customerId: string | null

  @column()
  declare variantId: string | null

  @column()
  declare plan: PlanId

  @column()
  declare status: SubscriptionStatus

  @column.dateTime()
  declare renewsAt: DateTime | null

  @column.dateTime()
  declare endsAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Czy daje dostęp do planu: aktywna, próbna, zaległa płatność (LS ponawia),
   * albo anulowana, ale opłacony okres jeszcze trwa.
   */
  get grantsAccess(): boolean {
    if (['active', 'on_trial', 'past_due'].includes(this.status)) return true
    if (this.status === 'cancelled') return Boolean(this.endsAt && this.endsAt > DateTime.utc())
    return false
  }
}
