import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import { OutboxTransport } from '#services/mail_outbox'

/**
 * Poczta: `smtp` w produkcji, `outbox` (domyślnie) lokalnie — maile trafiają
 * do `tmp/mail-outbox/` i podglądu `/dev/mailbox`, bez serwera pocztowego.
 */
const smtpUser = env.get('SMTP_USERNAME')

const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER', 'outbox'),

  from: {
    address: env.get('MAIL_FROM_ADDRESS', 'no-reply@design-canvas.local'),
    name: env.get('MAIL_FROM_NAME', 'Design Canvas'),
  },

  globals: {
    brandName: 'Design Canvas',
  },

  mailers: {
    outbox: () => new OutboxTransport(),
    smtp: transports.smtp({
      host: env.get('SMTP_HOST', 'localhost'),
      port: env.get('SMTP_PORT', 587),
      secure: env.get('SMTP_SECURE', false),
      ...(smtpUser
        ? { auth: { type: 'login' as const, user: smtpUser, pass: env.get('SMTP_PASSWORD', '') } }
        : {}),
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
