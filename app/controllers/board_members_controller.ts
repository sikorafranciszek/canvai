import { randomBytes } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import Board from '#models/board'
import BoardMember from '#models/board_member'
import User from '#models/user'
import { boardAccess, boardAccessOrStatus } from '#services/board_access'
import { entitlementsFor } from '#services/billing/plans'
import { appUrl } from '#services/lifecycle_mail'
import { currentLocale, t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { publish } from '#services/board_events'

const inviteValidator = vine.compile(
  vine.object({
    email: vine.string().trim().toLowerCase().email().maxLength(254),
    role: vine.enum(['editor', 'viewer'] as const),
  })
)
const roleValidator = vine.compile(vine.object({ role: vine.enum(['editor', 'viewer'] as const) }))

/**
 * Członkowie tablicy: zaproszenia mailem (link z tokenem), role edytor/podgląd,
 * usuwanie i opuszczanie tablicy. Liczba miejsc zależy od planu WŁAŚCICIELA.
 */
export default class BoardMembersController {
  private async payload(board: Board, viewerId: number) {
    const owner = await User.find(board.userId)
    const members = await BoardMember.query().where('board_id', board.id).orderBy('id', 'asc')
    const users = members.length
      ? await User.query().whereIn(
          'id',
          members.map((m) => m.userId).filter((x): x is number => x != null)
        )
      : []
    const manage = board.userId === viewerId
    const { limits } = await entitlementsFor(board.userId)
    return {
      canManage: manage,
      limit: Number.isFinite(limits.collaborators) ? limits.collaborators : null,
      owner: owner
        ? { id: owner.id, name: owner.fullName?.trim() || owner.email, email: owner.email }
        : null,
      members: members
        .filter((m) => manage || m.acceptedAt)
        .map((m) => {
          const u = users.find((x) => x.id === m.userId)
          return {
            id: m.id,
            email: m.email,
            name: u?.fullName?.trim() || null,
            role: m.role,
            pending: !m.acceptedAt,
            isYou: m.userId === viewerId,
          }
        }),
    }
  }

  /** GET /api/boards/:id/members */
  async index({ auth, params, response }: HttpContext) {
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.notFound()
    return response.json({ data: await this.payload(access.board, auth.user!.id) })
  }

  /** POST /api/boards/:id/members — zaproszenie (albo ponowne wysłanie). */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const user = auth.user!
    const access = await boardAccessOrStatus(user.id, params.id, 'manage')
    if (typeof access === 'number') return response.status(access).send('')
    const { board } = access
    const { email, role } = await request.validateUsing(inviteValidator)
    if (email === user.email.toLowerCase()) {
      return response.status(422).json({ message: t('members.self'), code: 'E_MEMBER_SELF' })
    }

    const existing = await BoardMember.query()
      .where('board_id', board.id)
      .where('email', email)
      .first()
    if (!existing) {
      const { limits } = await entitlementsFor(board.userId)
      const [{ $extras }] = await BoardMember.query()
        .where('board_id', board.id)
        .count('* as total')
      if (Number($extras.total) >= limits.collaborators) {
        return response.status(403).json({
          message:
            limits.collaborators > 0
              ? t('members.limit', { limit: limits.collaborators })
              : t('members.locked'),
          code: 'E_PLAN_FEATURE',
        })
      }
    }

    const member =
      existing ??
      new BoardMember().merge({ boardId: board.id, email, invitedById: user.id, acceptedAt: null })
    member.role = role
    if (!member.acceptedAt) member.token = randomBytes(24).toString('base64url')
    await member.save()

    if (!member.acceptedAt) {
      const url = appUrl(`/invites/${member.token}`)
      const inviter = user.fullName?.trim() || user.email
      try {
        await mail.send((message) => {
          message
            .to(email)
            .subject(t('members.mail.subject', { name: inviter, title: board.title }))
            .htmlView('emails/lifecycle', {
              locale: currentLocale(),
              subject: t('members.mail.subject', { name: inviter, title: board.title }),
              heading: t('members.mail.heading', { title: board.title }),
              greeting: t('mail.greeting', { name: '' }),
              paragraphs: [
                t('members.mail.p1', {
                  name: inviter,
                  title: board.title,
                  role: t(role === 'editor' ? 'members.role.editor' : 'members.role.viewer'),
                }),
                t('members.mail.p2'),
              ],
              stats: [],
              button: t('members.mail.button'),
              url,
              footer: t('mail.footer'),
              unsubscribe: '',
              unsubscribeUrl: url,
            })
            .text(`${t('members.mail.p1', { name: inviter, title: board.title, role })}\n\n${url}`)
        })
      } catch (error) {
        logger.warn({ err: error, boardId: board.id }, 'invite email failed')
      }
    }
    trackFor(ctx, 'member_invited', { role, resent: Boolean(existing) }, { boardId: board.id })
    return response.status(existing ? 200 : 201).json({ data: await this.payload(board, user.id) })
  }

  /** PATCH /api/boards/:id/members/:memberId — zmiana roli. */
  async update({ auth, params, request, response }: HttpContext) {
    const access = await boardAccessOrStatus(auth.user!.id, params.id, 'manage')
    if (typeof access === 'number') return response.status(access).send('')
    const member = await BoardMember.query()
      .where('board_id', access.board.id)
      .where('id', params.memberId)
      .first()
    if (!member) return response.notFound()
    member.role = (await request.validateUsing(roleValidator)).role
    await member.save()
    publish(access.board.id, 'members', {})
    return response.json({ data: await this.payload(access.board, auth.user!.id) })
  }

  /** DELETE /api/boards/:id/members/:memberId — usunięcie (właściciel) albo opuszczenie (członek). */
  async destroy({ auth, params, response }: HttpContext) {
    const access = await boardAccess(auth.user!.id, params.id, 'view')
    if (!access) return response.notFound()
    const member = await BoardMember.query()
      .where('board_id', access.board.id)
      .where('id', params.memberId)
      .first()
    if (!member) return response.notFound()
    const self = member.userId === auth.user!.id
    if (access.role !== 'owner' && !self) return response.forbidden()
    await member.delete()
    publish(access.board.id, 'members', {})
    return response.json({
      data:
        self && access.role !== 'owner' ? null : await this.payload(access.board, auth.user!.id),
    })
  }

  /** GET /invites/:token — przyjęcie zaproszenia (po zalogowaniu na zaproszony adres). */
  async accept({ auth, params, session, response }: HttpContext) {
    const token = String(params.token)
    const member = /^[A-Za-z0-9_-]{20,64}$/.test(token)
      ? await BoardMember.findBy('token', token)
      : null
    if (!member) {
      session.flash('error', t('members.invalidInvite'))
      return response.redirect().toPath('/boards')
    }
    if (!(await auth.check())) {
      // Po zalogowaniu albo rejestracji (i potwierdzeniu e-maila) wracamy tutaj.
      session.put('pendingInvite', token)
      session.flash('success', t('members.loginToJoin', { email: member.email }))
      return response.redirect().toPath('/login')
    }
    const user = auth.user!
    session.forget('pendingInvite')
    if (member.userId === user.id && member.acceptedAt) {
      return response.redirect().toPath(`/boards/${member.boardId}`)
    }
    if (user.email.toLowerCase() !== member.email.toLowerCase()) {
      session.flash('error', t('members.wrongAccount', { email: member.email }))
      return response.redirect().toPath('/boards')
    }
    if (!user.emailVerifiedAt) {
      session.put('pendingInvite', token)
      return response.redirect().toPath('/verify-email')
    }
    member.userId = user.id
    member.acceptedAt = DateTime.utc()
    await member.save()
    publish(member.boardId, 'members', {})
    session.flash('success', t('members.joined'))
    return response.redirect().toPath(`/boards/${member.boardId}`)
  }
}
