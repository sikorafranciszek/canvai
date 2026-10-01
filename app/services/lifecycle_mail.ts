import { createHmac, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import User from '#models/user'
import { costs, freeCredits } from '#config/billing'
import { balanceOf } from '#services/billing/credits'
import { planFor } from '#services/billing/plans'
import { runWithLocale, t } from '#services/i18n'
import { isLocale, type Locale } from '#shared/i18n'
import { track } from '#services/analytics/collector'

/**
 * Maile cykliczne (zadanie `lifecycle_emails`, co godzinę):
 * - `board_waiting` — tablica z materiałami bez DESIGN.md od ponad doby,
 * - `no_board` — potwierdzone konto bez własnej tablicy po 2 dniach,
 * - `credits_expiring` — kupione/podarowane kredyty wygasają w ciągu 7 dni,
 * - `weekly_summary` — poniedziałkowe podsumowanie dla Pro/Team (gdy była aktywność).
 *
 * Każdy mail najwyżej raz na (rodzaj, ref) — `email_log` z unikalnym kluczem.
 * Tylko konta potwierdzone, aktywne i z zgodą `marketing_emails`; w stopce
 * wypis jednym kliknięciem (+ nagłówki List-Unsubscribe, RFC 8058).
 */

const BATCH = 200

export function appUrl(path: string): string {
  const base = env.get('APP_URL') || 'http://localhost:3333'
  return `${String(base).replace(/\/$/, '')}${path}`
}

function sign(userId: number): string {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(`unsubscribe:${userId}`)
    .digest('base64url')
    .slice(0, 22)
}

export function unsubscribeToken(userId: number): string {
  return `${userId}.${sign(userId)}`
}

/** Id użytkownika z tokenu wypisu albo `null`, gdy podpis się nie zgadza. */
export function verifyUnsubscribeToken(token: string): number | null {
  const m = /^(\d{1,10})\.([A-Za-z0-9_-]{22})$/.exec(token)
  if (!m) return null
  const id = Number(m[1])
  const expected = Buffer.from(sign(id))
  const given = Buffer.from(m[2])
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null
}

interface LifecycleContent {
  subject: string
  heading: string
  paragraphs: string[]
  stats?: { label: string; value: string }[]
  button: string
  url: string
}

/** Rezerwuje wpis w dzienniku (atomowo); `false` = już wysłane. */
async function claim(userId: number, kind: string, ref: string): Promise<boolean> {
  const rows = await db
    .table('email_log')
    .insert({ user_id: userId, kind, ref, sent_at: new Date() })
    .onConflict(['user_id', 'kind', 'ref'])
    .ignore()
    .returning('id')
  return rows.length > 0
}

export async function sendLifecycle(
  user: User,
  kind: string,
  ref: string,
  build: () => Promise<LifecycleContent> | LifecycleContent
): Promise<boolean> {
  if (!(await claim(user.id, kind, ref))) return false
  const locale: Locale = isLocale(user.locale) ? user.locale : 'pl'
  try {
    await runWithLocale(locale, async () => {
      const content = await build()
      const firstName = user.fullName?.trim().split(/\s+/)[0]
      const unsubscribeUrl = appUrl(`/unsubscribe/${unsubscribeToken(user.id)}`)
      const data = {
        locale,
        ...content,
        stats: content.stats ?? [],
        greeting: t('mail.greeting', { name: firstName ? ` ${firstName}` : '' }),
        footer: t('lifecycle.footer'),
        unsubscribe: t('lifecycle.unsubscribe'),
        unsubscribeUrl,
      }
      const text = [
        data.heading,
        '',
        data.greeting,
        ...data.paragraphs,
        '',
        ...data.stats.map((s) => `${s.label}: ${s.value}`),
        '',
        `${data.button}: ${data.url}`,
        '',
        `${data.unsubscribe}: ${unsubscribeUrl}`,
      ].join('\n')
      await mail.send((message) => {
        message
          .to(user.email, user.fullName ?? undefined)
          .subject(content.subject)
          .header('List-Unsubscribe', `<${unsubscribeUrl}>`)
          .header('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click')
          .htmlView('emails/lifecycle', data)
          .text(text)
      })
    })
    track('lifecycle_email_sent', { kind }, { userId: user.id })
    return true
  } catch (error) {
    // Wysyłka się nie udała — zwalniamy wpis, żeby ponowić przy następnym przebiegu.
    await db.from('email_log').where({ user_id: user.id, kind, ref }).delete()
    logger.warn({ err: error, userId: user.id, kind }, 'lifecycle email failed')
    return false
  }
}

/** Konta, do których wolno pisać (potwierdzone, aktywne, ze zgodą). */
function eligibleUsers() {
  return db
    .from('users as u')
    .whereNotNull('u.email_verified_at')
    .whereNull('u.disabled_at')
    .where('u.marketing_emails', true)
}

function sqlNow(dt: DateTime) {
  return dt.toUTC().toJSDate()
}

async function boardWaiting(now: DateTime): Promise<number> {
  const rows = await eligibleUsers()
    .join('boards as b', 'b.user_id', 'u.id')
    .where('b.is_sample', false)
    .where('b.created_at', '<', sqlNow(now.minus({ hours: 24 })))
    .where('b.created_at', '>', sqlNow(now.minus({ days: 14 })))
    .whereExists((q) => q.from('assets as a').whereRaw('a.board_id = b.id'))
    .whereNotExists((q) => q.from('design_docs as d').whereRaw('d.board_id = b.id'))
    .whereNotExists((q) =>
      q
        .from('email_log as l')
        .whereRaw('l.user_id = u.id')
        .where('l.kind', 'board_waiting')
        .whereRaw('l.ref = b.id::text')
    )
    .select('u.id as user_id', 'b.id as board_id', 'b.title')
    .limit(BATCH)
  let sent = 0
  for (const row of rows) {
    const user = await User.find(row.user_id)
    if (!user) continue
    const ok = await sendLifecycle(user, 'board_waiting', String(row.board_id), async () => {
      const [{ n }] = await db.from('assets').where('board_id', row.board_id).count('* as n')
      const estimate = Number(n) * costs.perMaterial + costs.compose
      return {
        subject: t('lifecycle.boardWaiting.subject', { title: row.title }),
        heading: t('lifecycle.boardWaiting.heading'),
        paragraphs: [
          t('lifecycle.boardWaiting.p1', { title: row.title, n: Number(n) }),
          t('lifecycle.boardWaiting.p2', { credits: estimate, balance: await balanceOf(user.id) }),
        ],
        button: t('lifecycle.boardWaiting.button'),
        url: appUrl(`/boards/${row.board_id}`),
      }
    })
    if (ok) sent++
  }
  return sent
}

async function noBoard(now: DateTime): Promise<number> {
  const rows = await eligibleUsers()
    .where('u.email_verified_at', '<', sqlNow(now.minus({ hours: 48 })))
    .where('u.email_verified_at', '>', sqlNow(now.minus({ days: 14 })))
    .whereNotExists((q) =>
      q
        .from('boards as b')
        .whereRaw('b.user_id = u.id')
        .where('b.is_sample', false)
        .whereExists((a) => a.from('assets as a').whereRaw('a.board_id = b.id'))
    )
    .whereNotExists((q) =>
      q.from('email_log as l').whereRaw('l.user_id = u.id').where('l.kind', 'no_board')
    )
    .select('u.id')
    .limit(BATCH)
  let sent = 0
  for (const row of rows) {
    const user = await User.find(row.id)
    if (!user) continue
    const ok = await sendLifecycle(user, 'no_board', 'once', () => ({
      subject: t('lifecycle.noBoard.subject'),
      heading: t('lifecycle.noBoard.heading'),
      paragraphs: [
        t('lifecycle.noBoard.p1'),
        t('lifecycle.noBoard.p2', { credits: freeCredits.signup }),
      ],
      button: t('lifecycle.noBoard.button'),
      url: appUrl('/boards'),
    }))
    if (ok) sent++
  }
  return sent
}

async function creditsExpiring(now: DateTime): Promise<number> {
  const week = now.toFormat("kkkk-'W'WW")
  const rows = await eligibleUsers()
    .join('credit_grants as g', 'g.user_id', 'u.id')
    .whereNull('g.revoked_at')
    .where('g.remaining', '>', 0)
    .whereNot('g.source', 'monthly_free')
    .where('g.expires_at', '>', sqlNow(now))
    .where('g.expires_at', '<', sqlNow(now.plus({ days: 7 })))
    .whereNotExists((q) =>
      q
        .from('email_log as l')
        .whereRaw('l.user_id = u.id')
        .where('l.kind', 'credits_expiring')
        .where('l.ref', week)
    )
    .groupBy('u.id')
    .select('u.id')
    .sum('g.remaining as credits')
    .min('g.expires_at as first_expiry')
    .limit(BATCH)
  let sent = 0
  for (const row of rows) {
    const user = await User.find(row.id)
    if (!user) continue
    const ok = await sendLifecycle(user, 'credits_expiring', week, () => {
      const when = DateTime.fromJSDate(new Date(row.first_expiry))
        .setLocale(isLocale(user.locale) ? user.locale : 'pl')
        .toLocaleString(DateTime.DATE_FULL)
      return {
        subject: t('lifecycle.credits.subject', { credits: Number(row.credits) }),
        heading: t('lifecycle.credits.heading'),
        paragraphs: [t('lifecycle.credits.p1', { credits: Number(row.credits), date: when })],
        button: t('lifecycle.credits.button'),
        url: appUrl('/boards'),
      }
    })
    if (ok) sent++
  }
  return sent
}

async function weeklySummary(now: DateTime): Promise<number> {
  if (now.weekday !== 1) return 0
  const week = now.toFormat("kkkk-'W'WW")
  const since = sqlNow(now.minus({ days: 7 }))
  const rows = await eligibleUsers()
    .join('subscriptions as s', 's.user_id', 'u.id')
    .whereIn('s.plan', ['pro', 'team', 'agency'])
    .whereExists((q) =>
      q
        .from('design_docs as d')
        .join('boards as b', 'b.id', 'd.board_id')
        .whereRaw('b.user_id = u.id')
        .where('d.created_at', '>', since)
    )
    .whereNotExists((q) =>
      q
        .from('email_log as l')
        .whereRaw('l.user_id = u.id')
        .where('l.kind', 'weekly_summary')
        .where('l.ref', week)
    )
    .distinct('u.id')
    .limit(BATCH)
  let sent = 0
  for (const row of rows) {
    const user = await User.find(row.id)
    if (!user) continue
    const plan = await planFor(user.id)
    if (plan !== 'pro' && plan !== 'team' && plan !== 'agency') continue
    const ok = await sendLifecycle(user, 'weekly_summary', week, async () => {
      const [docs] = await db
        .from('design_docs as d')
        .join('boards as b', 'b.id', 'd.board_id')
        .where('b.user_id', user.id)
        .where('d.created_at', '>', since)
        .where('d.status', 'ready')
        .count('* as n')
        .countDistinct('d.board_id as boards')
      const [assets] = await db
        .from('assets as a')
        .join('boards as b', 'b.id', 'a.board_id')
        .where('b.user_id', user.id)
        .where('a.created_at', '>', since)
        .count('* as n')
      const [spent] = await db
        .from('credit_transactions')
        .where('user_id', user.id)
        .whereIn('kind', ['reserve', 'release'])
        .where('created_at', '>', since)
        .sum('amount as total')
      return {
        subject: t('lifecycle.weekly.subject'),
        heading: t('lifecycle.weekly.heading'),
        paragraphs: [t('lifecycle.weekly.p1')],
        stats: [
          { label: t('lifecycle.weekly.docs'), value: String(Number(docs.n)) },
          { label: t('lifecycle.weekly.boards'), value: String(Number(docs.boards)) },
          { label: t('lifecycle.weekly.materials'), value: String(Number(assets.n)) },
          {
            label: t('lifecycle.weekly.credits'),
            value: String(Math.abs(Number(spent.total ?? 0))),
          },
          { label: t('lifecycle.weekly.balance'), value: String(await balanceOf(user.id)) },
        ],
        button: t('lifecycle.weekly.button'),
        url: appUrl('/boards'),
      }
    })
    if (ok) sent++
  }
  return sent
}

/** Jeden przebieg wszystkich kampanii. Zwraca liczbę wysłanych maili na rodzaj. */
export async function runLifecycleEmails(now = DateTime.utc()) {
  return {
    boardWaiting: await boardWaiting(now),
    noBoard: await noBoard(now),
    creditsExpiring: await creditsExpiring(now),
    weeklySummary: await weeklySummary(now),
  }
}
