import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import ApiToken from '#models/api_token'
import Asset from '#models/asset'
import Board from '#models/board'
import CreditGrant from '#models/credit_grant'
import CreditTransaction from '#models/credit_transaction'
import CrmNote from '#models/crm_note'
import Subscription from '#models/subscription'
import User from '#models/user'
import { crm } from '#config/analytics'
import { stats as pipelineStats, track } from '#services/analytics/collector'
import { balanceOf, grantCredits, nextExpiry, sqlTime } from '#services/billing/credits'
import { entitlementsFor } from '#services/billing/plans'
import { referralStats } from '#services/billing/referrals'
import { deleteAssetFiles } from '#services/assets_service'
import { issueToken } from '#services/account_tokens'
import { sendPasswordResetEmail } from '#services/account_mail'
import { isAdmin } from '#services/crm/admin'
import { rateLimited } from '#services/portal'
import {
  FUNNEL,
  analyticsAvailable,
  dashboard,
  errorGroups,
  eraseUserAnalytics,
  eventSeries,
  eventTypes,
  funnel,
  logLevels,
  logs,
  rangeDays,
  recentEvents,
  requestSeries,
  retention,
  routeStats,
  userActivity,
} from '#services/crm/metrics'
import env from '#start/env'

const PAGE_SIZE = 25

const creditsValidator = vine.compile(
  vine.object({
    amount: vine.number().withoutDecimals().min(1).max(100_000),
    note: vine.string().trim().maxLength(200).optional(),
    expiresMonths: vine.number().withoutDecimals().min(0).max(36).optional(),
  })
)
const noteValidator = vine.compile(
  vine.object({ body: vine.string().trim().minLength(1).maxLength(4000) })
)
const tagsValidator = vine.compile(
  vine.object({ tags: vine.array(vine.string().trim().minLength(1).maxLength(40)).maxLength(20) })
)
const deleteValidator = vine.compile(vine.object({ confirmEmail: vine.string().trim() }))
const loginValidator = vine.compile(
  vine.object({ email: vine.string().trim().email(), password: vine.string() })
)

/** Adres aplikacji (link „otwórz w aplikacji”). */
function appUrl(): string {
  return env.get('APP_URL') || 'https://app.canvai.dev'
}

/**
 * Panel CRM (crm.canvai.dev): pulpit, użytkownicy (plan, kredyty, tablice,
 * aktywność, notatki, tagi, akcje), analityka (lejek, retencja, zdarzenia)
 * i logi (błędy, żądania). Każda akcja administratora trafia do analityki
 * jako `crm_action` (ślad audytowy).
 */
export default class CrmController {
  private audit(
    ctx: HttpContext,
    action: string,
    targetUserId: number,
    props: Record<string, unknown> = {}
  ) {
    track('crm_action', { action, targetUserId, ...props }, { userId: ctx.auth.user!.id })
    logger.info({ userId: ctx.auth.user!.id, action, targetUserId }, 'crm action')
  }

  // -------------------------------------------------------------------------
  // Logowanie
  // -------------------------------------------------------------------------

  async loginPage({ inertia, auth, response }: HttpContext) {
    await auth.check()
    if (isAdmin(auth.user)) return response.redirect().toPath('/')
    return inertia.render('crm/login' as any, {} as any)
  }

  async login(ctx: HttpContext) {
    const { request, auth, response, session } = ctx
    const { email, password } = await request.validateUsing(loginValidator)
    // Ochrona przed zgadywaniem haseł: 10 prób na 15 minut z jednego IP.
    if (rateLimited(`crm-login:${request.ip()}`, 10, 15 * 60_000)) {
      logger.warn({ ip: request.ip() }, 'crm login rate limited')
      session.flash('error', 'crm.login.rateLimited')
      return response.redirect().toPath('/login')
    }
    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch {
      session.flash('error', 'crm.login.invalid')
      return response.redirect().toPath('/login')
    }
    if (!isAdmin(user)) {
      logger.warn({ email }, 'crm login denied (not an admin)')
      session.flash('error', 'crm.login.denied')
      return response.redirect().toPath('/login')
    }
    await auth.use('web').login(user)
    track('crm_login', {}, { userId: user.id })
    return response.redirect().toPath('/')
  }

  async logout({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect().toPath('/login')
  }

  // -------------------------------------------------------------------------
  // Pulpit
  // -------------------------------------------------------------------------

  async dashboard({ inertia, request }: HttpContext) {
    const range = String(request.qs().range ?? '30d')
    const data = await dashboard(rangeDays(range))
    return inertia.render('crm/dashboard' as any, { range, data, pipeline: pipelineStats() } as any)
  }

  // -------------------------------------------------------------------------
  // Użytkownicy
  // -------------------------------------------------------------------------

  async users({ inertia, request }: HttpContext) {
    const qs = request.qs()
    const q = String(qs.q ?? '').trim()
    const plan = ['free', 'payg', 'pro', 'team'].includes(qs.plan) ? String(qs.plan) : ''
    const status = ['verified', 'unverified', 'disabled'].includes(qs.status)
      ? String(qs.status)
      : ''
    const tag = String(qs.tag ?? '').trim()
    const sort = ['newest', 'oldest', 'balance', 'boards', 'docs'].includes(qs.sort)
      ? String(qs.sort)
      : 'newest'
    const page = Math.max(1, Number.parseInt(qs.page, 10) || 1)
    const now = sqlTime(DateTime.utc())

    const base = db
      .from('users as u')
      .select(
        'u.id',
        'u.email',
        'u.full_name',
        'u.created_at',
        'u.email_verified_at',
        'u.disabled_at',
        'u.crm_tags',
        db.raw('(select count(*) from boards b where b.user_id = u.id) as boards'),
        db.raw(
          '(select count(*) from design_docs d join boards b on b.id = d.board_id where b.user_id = u.id) as docs'
        ),
        db.raw(
          `(select coalesce(sum(g.remaining), 0) from credit_grants g where g.user_id = u.id and g.revoked_at is null and (g.expires_at is null or g.expires_at > ?)) as balance`,
          [now]
        ),
        db.raw(
          `(select s.plan from subscriptions s where s.user_id = u.id and s.status in ('active','trialing','past_due') order by s.id desc limit 1) as sub_plan`
        ),
        db.raw(
          `exists(select 1 from credit_grants g where g.user_id = u.id and g.source = 'pack' and g.revoked_at is null) as has_pack`
        )
      )
    if (q) {
      base.where((w) => {
        w.whereRaw('lower(u.email) like ?', [`%${q.toLowerCase()}%`]).orWhereRaw(
          'lower(u.full_name) like ?',
          [`%${q.toLowerCase()}%`]
        )
        if (/^\d+$/.test(q)) w.orWhere('u.id', Number(q))
      })
    }
    if (status === 'verified') base.whereNotNull('u.email_verified_at').whereNull('u.disabled_at')
    if (status === 'unverified') base.whereNull('u.email_verified_at')
    if (status === 'disabled') base.whereNotNull('u.disabled_at')
    if (tag) base.whereRaw('u.crm_tags like ?', [`%"${tag.replace(/"/g, '')}"%`])

    const wrapped = db
      .from(base.as('x'))
      .select(
        '*',
        db.raw(`coalesce(sub_plan, case when has_pack then 'payg' else 'free' end) as plan`)
      )
    if (plan)
      wrapped.whereRaw(`coalesce(sub_plan, case when has_pack then 'payg' else 'free' end) = ?`, [
        plan,
      ])

    const totalRow = await db.from(wrapped.clone().as('t')).count('* as n')
    const total = Number(totalRow[0].n)
    const order: Record<string, [string, 'asc' | 'desc']> = {
      newest: ['created_at', 'desc'],
      oldest: ['created_at', 'asc'],
      balance: ['balance', 'desc'],
      boards: ['boards', 'desc'],
      docs: ['docs', 'desc'],
    }
    const [col, dir] = order[sort]
    const rows = await wrapped
      .orderBy(col, dir)
      .orderBy('id', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
    const activity = await userActivity(rows.map((r: any) => Number(r.id)))

    const tagRows = await db.from('users').whereNotNull('crm_tags').select('crm_tags')
    const allTags = [...new Set(tagRows.flatMap((r: any) => safeTags(r.crm_tags)))].sort()

    return inertia.render(
      'crm/users' as any,
      {
        filters: { q, plan, status, tag, sort, page },
        total,
        pageSize: PAGE_SIZE,
        tags: allTags,
        analytics: analyticsAvailable(),
        users: rows.map((r: any) => ({
          id: Number(r.id),
          email: r.email,
          fullName: r.full_name,
          createdAt: r.created_at,
          verified: Boolean(r.email_verified_at),
          disabled: Boolean(r.disabled_at),
          tags: safeTags(r.crm_tags),
          boards: Number(r.boards),
          docs: Number(r.docs),
          balance: Number(r.balance),
          plan: r.plan,
          lastSeen: activity.get(Number(r.id))?.lastSeen ?? null,
          events30d: activity.get(Number(r.id))?.events30d ?? 0,
        })),
      } as any
    )
  }

  async user({ inertia, params, response }: HttpContext) {
    const user = await User.find(params.id)
    if (!user) return response.notFound()

    const [
      ent,
      balance,
      expiry,
      subs,
      grants,
      transactions,
      boards,
      notes,
      tokens,
      referral,
      referredBy,
    ] = await Promise.all([
      entitlementsFor(user.id),
      balanceOf(user.id),
      nextExpiry(user.id),
      Subscription.query().where('user_id', user.id).orderBy('id', 'desc'),
      CreditGrant.query().where('user_id', user.id).orderBy('id', 'desc').limit(50),
      CreditTransaction.query().where('user_id', user.id).orderBy('id', 'desc').limit(50),
      db
        .from('boards as b')
        .where('b.user_id', user.id)
        .select(
          'b.id',
          'b.title',
          'b.created_at',
          'b.updated_at',
          db.raw('(select count(*) from assets a where a.board_id = b.id) as assets'),
          db.raw('(select count(*) from design_docs d where d.board_id = b.id) as docs'),
          db.raw(
            '(select d.status from design_docs d where d.board_id = b.id order by d.version desc limit 1) as last_status'
          ),
          db.raw(
            '(select count(*) from board_shares s where s.board_id = b.id and s.revoked_at is null) as shared'
          )
        )
        .orderBy('b.updated_at', 'desc'),
      CrmNote.query().where('user_id', user.id).orderBy('id', 'desc'),
      ApiToken.query().where('user_id', user.id).whereNull('revoked_at').count('* as n'),
      referralStats(user.id),
      user.referredById ? User.find(user.referredById) : null,
    ])
    const authors = await User.query().whereIn('id', [
      ...new Set(notes.map((n) => n.authorId).filter(Boolean) as number[]),
    ])

    const [timeline, errors, eventCounts, activity] = await Promise.all([
      recentEvents({ userId: user.id }, 100),
      logs({ userId: user.id, level: 'error', days: 90 }, 30),
      analyticsAvailable()
        ? (await import('#services/crm/metrics')).ch<{ event: string; n: string }>(
            `SELECT event, count() AS n FROM ${(await import('#services/analytics/clickhouse')).db()}.events
             WHERE user_id = {id:UInt64} AND ts >= now() - INTERVAL 90 DAY GROUP BY event ORDER BY n DESC`,
            { id: user.id }
          )
        : null,
      userActivity([user.id]),
    ])

    return inertia.render(
      'crm/user' as any,
      {
        appUrl: appUrl(),
        analytics: analyticsAvailable(),
        // `profile`, nie `user` — `user` to współdzielony prop zalogowanego administratora.
        profile: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          locale: user.locale,
          createdAt: user.createdAt?.toISO() ?? null,
          emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
          disabledAt: user.disabledAt?.toISO() ?? null,
          tags: user.crmTags ?? [],
          isAdmin: crm.adminEmails.includes(user.email.toLowerCase()),
          referralCode: user.referralCode,
          referredBy: referredBy ? { id: referredBy.id, email: referredBy.email } : null,
          lastSeen: activity.get(user.id)?.lastSeen ?? null,
        },
        plan: ent.plan,
        limits: ent.limits,
        balance,
        nextExpiry: expiry,
        apiTokens: Number(tokens[0].$extras.n),
        referral,
        subscriptions: subs.map((s) => ({
          id: s.id,
          plan: s.plan,
          status: s.status,
          externalId: s.externalId,
          renewsAt: s.renewsAt?.toISO() ?? null,
          endsAt: s.endsAt?.toISO() ?? null,
          createdAt: s.createdAt?.toISO() ?? null,
        })),
        grants: grants.map((g) => ({
          id: g.id,
          source: g.source,
          amount: g.amount,
          remaining: g.remaining,
          expiresAt: g.expiresAt?.toISO() ?? null,
          revokedAt: g.revokedAt?.toISO() ?? null,
          externalId: g.externalId,
          createdAt: g.createdAt?.toISO() ?? null,
        })),
        transactions: transactions.map((tx) => ({
          id: tx.id,
          kind: tx.kind,
          amount: tx.amount,
          note: tx.note,
          designDocId: tx.designDocId,
          createdAt: tx.createdAt?.toISO() ?? null,
        })),
        boards: boards.map((b: any) => ({
          id: Number(b.id),
          title: b.title,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
          assets: Number(b.assets),
          docs: Number(b.docs),
          lastStatus: b.last_status,
          shared: Number(b.shared) > 0,
        })),
        notes: notes.map((n) => ({
          id: n.id,
          body: n.body,
          author: authors.find((a) => a.id === n.authorId)?.email ?? null,
          createdAt: n.createdAt?.toISO() ?? null,
        })),
        timeline,
        errors,
        eventCounts: eventCounts?.map((e) => ({ event: e.event, count: Number(e.n) })) ?? null,
      } as any
    )
  }

  async grantCredits(ctx: HttpContext) {
    const { params, request, response, session } = ctx
    const user = await User.findOrFail(params.id)
    const { amount, note, expiresMonths = 12 } = await request.validateUsing(creditsValidator)
    await grantCredits(user.id, {
      source: 'admin',
      amount,
      expiresAt: expiresMonths > 0 ? DateTime.utc().plus({ months: expiresMonths }) : null,
      externalId: `admin:${ctx.auth.user!.id}:${user.id}:${Date.now()}`,
      note: note ? `admin: ${note}` : 'admin',
    })
    this.audit(ctx, 'grant_credits', user.id, { amount })
    session.flash('success', 'crm.flash.credits')
    return response.redirect().back()
  }

  async verifyEmail(ctx: HttpContext) {
    const user = await User.findOrFail(ctx.params.id)
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = DateTime.utc()
      await user.save()
      this.audit(ctx, 'verify_email', user.id)
    }
    ctx.session.flash('success', 'crm.flash.verified')
    return ctx.response.redirect().back()
  }

  async setDisabled(ctx: HttpContext) {
    const user = await User.findOrFail(ctx.params.id)
    const disable = ctx.request.url().endsWith('/disable')
    if (disable && user.id === ctx.auth.user!.id) {
      ctx.session.flash('error', 'crm.flash.selfDisable')
      return ctx.response.redirect().back()
    }
    user.disabledAt = disable ? DateTime.utc() : null
    await user.save()
    this.audit(ctx, disable ? 'disable' : 'enable', user.id)
    ctx.session.flash('success', disable ? 'crm.flash.disabled' : 'crm.flash.enabled')
    return ctx.response.redirect().back()
  }

  async sendReset(ctx: HttpContext) {
    const user = await User.findOrFail(ctx.params.id)
    const token = await issueToken(user, 'password_reset')
    try {
      await sendPasswordResetEmail(user, `${appUrl()}/reset-password/${token}`)
      this.audit(ctx, 'password_reset', user.id)
      ctx.session.flash('success', 'crm.flash.resetSent')
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'crm reset email failed')
      ctx.session.flash('error', 'crm.flash.mailFailed')
    }
    return ctx.response.redirect().back()
  }

  async addNote(ctx: HttpContext) {
    const user = await User.findOrFail(ctx.params.id)
    const { body } = await ctx.request.validateUsing(noteValidator)
    await CrmNote.create({ userId: user.id, authorId: ctx.auth.user!.id, body })
    this.audit(ctx, 'note_added', user.id)
    return ctx.response.redirect().back()
  }

  async deleteNote(ctx: HttpContext) {
    await CrmNote.query().where('id', ctx.params.noteId).where('user_id', ctx.params.id).delete()
    return ctx.response.redirect().back()
  }

  async setTags(ctx: HttpContext) {
    const user = await User.findOrFail(ctx.params.id)
    const { tags } = await ctx.request.validateUsing(tagsValidator)
    user.crmTags = [...new Set(tags.map((t) => t.toLowerCase()))]
    await user.save()
    this.audit(ctx, 'tags', user.id, { tags: user.crmTags })
    return ctx.response.redirect().back()
  }

  /** Usunięcie konta (RODO): pliki, dane w bazie (kaskady) i dane analityczne. */
  async destroy(ctx: HttpContext) {
    const { params, request, response, session } = ctx
    const user = await User.findOrFail(params.id)
    const { confirmEmail } = await request.validateUsing(deleteValidator)
    if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      session.flash('error', 'crm.flash.confirmMismatch')
      return response.redirect().back()
    }
    if (user.id === ctx.auth.user!.id) {
      session.flash('error', 'crm.flash.selfDelete')
      return response.redirect().back()
    }
    const boardIds = (await Board.query().where('user_id', user.id).select('id')).map((b) => b.id)
    if (boardIds.length) {
      for (const asset of await Asset.query().whereIn('board_id', boardIds))
        await deleteAssetFiles(asset)
    }
    const userId = user.id
    await user.delete()
    try {
      await eraseUserAnalytics(userId)
    } catch (error) {
      logger.error({ err: error, userId }, 'erasing analytics failed')
    }
    this.audit(ctx, 'delete_account', userId, { boards: boardIds.length })
    session.flash('success', 'crm.flash.deleted')
    return response.redirect().toPath('/users')
  }

  // -------------------------------------------------------------------------
  // Analityka i logi
  // -------------------------------------------------------------------------

  async analytics({ inertia, request }: HttpContext) {
    const qs = request.qs()
    const range = String(qs.range ?? '30d')
    const days = rangeDays(range)
    const types = await eventTypes(days)
    const event =
      typeof qs.event === 'string' && qs.event ? qs.event : (types?.[0]?.event ?? 'page_view')
    const [series, funnelData, retentionData, recent] = await Promise.all([
      eventSeries(event, days),
      funnel(days),
      retention(8),
      recentEvents({ event }, 50),
    ])
    return inertia.render(
      'crm/analytics' as any,
      {
        range,
        event,
        analytics: analyticsAvailable(),
        eventTypes: types,
        series,
        funnel: funnelData,
        funnelSteps: FUNNEL,
        retention: retentionData,
        recent,
      } as any
    )
  }

  async logs({ inertia, request }: HttpContext) {
    const qs = request.qs()
    const range = String(qs.range ?? '7d')
    const days = rangeDays(range)
    const tab = ['logs', 'errors', 'requests'].includes(qs.tab) ? String(qs.tab) : 'errors'
    const level = ['info', 'warn', 'error', 'fatal'].includes(qs.level) ? String(qs.level) : ''
    const q = String(qs.q ?? '')
      .trim()
      .slice(0, 200)
    const userId = Number.parseInt(qs.user, 10) || undefined

    const [levels, list, groups, routes, reqSeries] = await Promise.all([
      logLevels(days),
      tab === 'logs' ? logs({ level, q, userId, days }) : null,
      tab === 'errors' ? errorGroups(days) : null,
      tab === 'requests' ? routeStats(days) : null,
      requestSeries(days),
    ])
    return inertia.render(
      'crm/logs' as any,
      {
        range,
        tab,
        filters: { level, q, user: userId ?? '' },
        analytics: analyticsAvailable(),
        levels,
        logs: list,
        errorGroups: groups,
        routes,
        requestSeries: reqSeries,
      } as any
    )
  }
}

function safeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
