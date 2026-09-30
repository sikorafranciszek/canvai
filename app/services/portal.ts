import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import Board from '#models/board'
import BoardShare from '#models/board_share'
import User from '#models/user'
import { isLocale } from '#shared/i18n'
import { currentLocale, runWithLocale, t } from '#services/i18n'

/**
 * Portal klienta: link udostępniania tablicy (nieodgadywalny token w URL,
 * odwoływalny i wymienialny) + powiadomienia właściciela e-mailem.
 */

export function newShareToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function findActiveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,48}$/.test(token)) return null
  const share = await BoardShare.query().where('token', token).whereNull('revoked_at').first()
  if (!share) return null
  const board = await Board.find(share.boardId)
  if (!board) return null
  const owner = await User.find(board.userId)
  return owner ? { share, board, owner } : null
}

/** Prosty limit żądań portalu w pamięci procesu (na token i akcję). */
const hits = new Map<string, number[]>()
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((ts) => now - ts < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}

/** Powiadomienie właściciela tablicy (w jego języku). Błąd wysyłki nie przerywa akcji klienta. */
export async function notifyOwner(
  owner: User,
  kind: 'materials' | 'approved' | 'changes',
  vars: { name: string; board: string; count?: number; version?: number; comment?: string | null },
  url: string
) {
  const locale = isLocale(owner.locale) ? owner.locale : currentLocale()
  await runWithLocale(locale, async () => {
    const firstName = owner.fullName?.trim().split(/\s+/)[0]
    const intro = t(`portal.mail.${kind}.intro`, {
      name: vars.name,
      board: vars.board,
      count: vars.count ?? 0,
      version: vars.version ?? 0,
    })
    const data = {
      locale,
      subject: t(`portal.mail.${kind}.subject`, { name: vars.name, board: vars.board }),
      heading: t(`portal.mail.${kind}.heading`),
      greeting: t('mail.greeting', { name: firstName ? ` ${firstName}` : '' }),
      intro: vars.comment ? `${intro} „${vars.comment.slice(0, 500)}”` : intro,
      button: t('portal.mail.button'),
      expires: '',
      ignore: '',
      linkFallback: t('mail.linkFallback'),
      footer: t('mail.footer'),
      url,
    }
    try {
      await mail.send((message) => {
        message
          .to(owner.email, owner.fullName ?? undefined)
          .subject(data.subject)
          .htmlView('emails/account', data)
          .text(
            [data.heading, '', data.greeting, data.intro, '', `${data.button}: ${url}`].join('\n')
          )
      })
    } catch (error) {
      logger.error({ err: error }, 'portal notification failed')
    }
  })
}
