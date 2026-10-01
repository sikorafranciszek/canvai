import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { column } from '@adonisjs/lucid/orm'
import { jsonConsume, jsonPrepare } from '#models/json_columns'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  /** Token Figmy zaszyfrowany kluczem aplikacji — nigdy nie trafia do klienta. */
  @column({ serializeAs: null })
  declare figmaToken: string | null

  /** Zgoda na maile cykliczne (przypomnienia, podsumowania); wypis jednym kliknięciem. */
  @column({ consume: (v) => Boolean(v) })
  declare marketingEmails: boolean

  /** Dane do faktury (zakupy firmowe w Polar). */
  @column()
  declare billingCompany: string | null

  @column()
  declare billingTaxId: string | null

  /** White-label (plan Agency): marka w portalu klienta, PDF i DESIGN.md. */
  @column()
  declare brandName: string | null

  @column({ serializeAs: null })
  declare brandLogoKey: string | null

  @column()
  declare brandAccent: string | null

  /** Własna domena portalu klienta (CNAME na aplikację). */
  @column()
  declare portalDomain: string | null

  /** Tagi nadawane w CRM (np. „agencja”, „beta”). */
  @column({ prepare: jsonPrepare, consume: jsonConsume })
  declare crmTags: string[] | null

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
