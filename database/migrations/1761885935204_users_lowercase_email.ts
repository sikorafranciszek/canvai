import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * SEC-13: adresy e-mail małymi literami — logowanie i rejestracja normalizują
 * adres. Konta, których adres po zmianie zderzyłby się z innym, zostają bez zmian.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(
        `update users set email = lower(email)
         where email <> lower(email)
           and not exists (select 1 from users u2 where u2.email = lower(users.email))
           and (select count(*) from users u3 where lower(u3.email) = lower(users.email)) = 1`
      )
    })
  }

  async down() {}
}
