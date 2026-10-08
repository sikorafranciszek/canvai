import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { PlanId } from '#config/billing'

/** Statusy subskrypcji Polar. */
export type SubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

/** Lustro subskrypcji z Polar (aktualizowane webhookami). */
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

  /** ID produktu w Polar. */
  @column()
  declare productId: string | null

  @column()
  declare plan: PlanId

  @column()
  declare status: SubscriptionStatus

  @column.dateTime()
  declare renewsAt: DateTime | null

  @column.dateTime()
  declare endsAt: DateTime | null

  /** Czas zdarzenia Polar, z którego pochodzi stan (SEC-15). */
  @column.dateTime()
  declare sourceModifiedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Czy daje dostęp do planu: aktywna, próbna, zaległa płatność (Polar ponawia),
   * albo anulowana, ale opłacony okres jeszcze trwa.
   */
  get grantsAccess(): boolean {
    if (['active', 'trialing', 'past_due'].includes(this.status)) {
      return !this.endsAt || this.endsAt > DateTime.utc()
    }
    if (this.status === 'canceled') return Boolean(this.endsAt && this.endsAt > DateTime.utc())
    return false
  }
}
