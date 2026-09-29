import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import type User from '#models/user'
import { currentLocale, t } from '#services/i18n'
import { issueToken } from '#services/account_tokens'
import { absoluteUrl } from '#services/app_url'

/**
 * Maile konta (weryfikacja, reset hasła, powiadomienie o zmianie hasła) —
 * w języku bieżącego żądania, HTML (resources/views/emails/account.edge)
 * + wersja tekstowa. Wysyłka synchroniczna: błąd wysyłki nie blokuje rejestracji
 * (wołający decyduje, co pokazać), ale jest zgłaszany.
 */

type Kind = 'verify' | 'reset' | 'passwordChanged'

const KEYS = {
  verify: {
    subject: 'mail.verify.subject',
    heading: 'mail.verify.heading',
    intro: 'mail.verify.intro',
    button: 'mail.verify.button',
    expires: 'mail.verify.expires',
    ignore: 'mail.verify.ignore',
  },
  reset: {
    subject: 'mail.reset.subject',
    heading: 'mail.reset.heading',
    intro: 'mail.reset.intro',
    button: 'mail.reset.button',
    expires: 'mail.reset.expires',
    ignore: 'mail.reset.ignore',
  },
  passwordChanged: {
    subject: 'mail.passwordChanged.subject',
    heading: 'mail.passwordChanged.heading',
    intro: 'mail.passwordChanged.intro',
    button: 'mail.passwordChanged.button',
    expires: null,
    ignore: 'mail.passwordChanged.ignore',
  },
} as const

async function sendAccountMail(kind: Kind, user: User, url: string) {
  const k = KEYS[kind]
  const firstName = user.fullName?.trim().split(/\s+/)[0]
  const data = {
    locale: currentLocale(),
    subject: t(k.subject),
    heading: t(k.heading),
    greeting: t('mail.greeting', { name: firstName ? ` ${firstName}` : '' }),
    intro: t(k.intro),
    button: t(k.button),
    expires: k.expires ? t(k.expires) : '',
    ignore: t(k.ignore),
    linkFallback: t('mail.linkFallback'),
    footer: t('mail.footer'),
    url,
  }
  const text = [
    data.heading,
    '',
    data.greeting,
    data.intro,
    '',
    `${data.button}: ${url}`,
    data.expires,
    '',
    data.ignore,
    '',
    data.footer,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')

  await mail.send((message) => {
    message
      .to(user.email, user.fullName ?? undefined)
      .subject(data.subject)
      .htmlView('emails/account', data)
      .text(text)
  })
}

export const sendVerificationEmail = (user: User, url: string) =>
  sendAccountMail('verify', user, url)
export const sendPasswordResetEmail = (user: User, url: string) =>
  sendAccountMail('reset', user, url)
export const sendPasswordChangedEmail = (user: User, url: string) =>
  sendAccountMail('passwordChanged', user, url)

/** Wydaje token i wysyła link weryfikacyjny. Zwraca false, gdy wysyłka się nie udała. */
export async function sendVerificationLink(ctx: HttpContext, user: User): Promise<boolean> {
  const token = await issueToken(user, 'email_verification')
  try {
    await sendVerificationEmail(user, absoluteUrl(ctx, `/verify-email/${token}`))
    return true
  } catch (error) {
    logger.error({ err: error, userId: user.id }, 'verification email failed')
    return false
  }
}
