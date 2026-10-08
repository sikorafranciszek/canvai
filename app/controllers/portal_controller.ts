import { diffDocs, previousReady } from '#services/design/spec_diff'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Asset from '#models/asset'
import DesignDoc from '#models/design_doc'
import PortalFeedback from '#models/portal_feedback'
import { entitlementsFor } from '#services/billing/plans'
import { storeLink, storeUploadedFile } from '#services/assets_service'
import { findActiveShare, notifyOwner, printBrand, rateLimited } from '#services/portal'
import { absoluteUrl } from '#services/app_url'
import { t } from '#services/i18n'
import { track } from '#services/analytics/collector'

const MAX_FILES = 10

const materialsValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(120),
    note: vine.string().trim().maxLength(2000).optional(),
    url: vine.string().trim().url({ require_protocol: true }).maxLength(2000).optional(),
  })
)

const feedbackValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(120),
    decision: vine.enum(['approved', 'changes']),
    comment: vine.string().trim().maxLength(4000).optional(),
    version: vine.number().withoutDecimals().positive(),
  })
)

/**
 * Publiczny portal klienta (`/c/:token`) — bez konta. Klient przesyła
 * materiały (trafiają do skrzynki „Od klienta” właściciela) i ocenia DESIGN.md.
 * Dostęp wygasa po odwołaniu linku albo utracie płatnego planu przez właściciela.
 */
export default class PortalController {
  private async resolve(token: string) {
    const found = await findActiveShare(token)
    if (!found) return null
    const { limits } = await entitlementsFor(found.owner.id)
    return limits.portal ? { ...found, limits } : null
  }

  /** GET /c/:token */
  /** GET /c/:token/print — DESIGN.md dla klienta do druku / PDF. */
  async print({ params, inertia, response }: HttpContext) {
    const found = await this.resolve(String(params.token))
    if (!found || !found.share.showDoc) {
      response.status(404)
      return inertia.render('errors/not_found' as any, {} as any)
    }
    const { share, board, owner } = found
    const doc = await DesignDoc.query()
      .where('board_id', board.id)
      .where('status', 'ready')
      .orderBy('version', 'desc')
      .first()
    if (!doc?.contentMd) {
      response.status(404)
      return inertia.render('errors/not_found' as any, {} as any)
    }
    return inertia.render(
      'print/design_doc' as any,
      {
        doc: {
          title: board.title,
          version: doc.version,
          contentMd: doc.contentMd,
          generatedAt: doc.generatedAt?.toISO() ?? null,
        },
        preparedBy: await printBrand(owner.id),
        backHref: `/c/${share.token}`,
      } as any
    )
  }

  async show({ params, inertia, response }: HttpContext) {
    const found = await this.resolve(String(params.token))
    if (!found) {
      response.status(404)
      return inertia.render('errors/not_found' as any, {} as any)
    }
    const { share, board, owner } = found
    const doc = share.showDoc
      ? await DesignDoc.query()
          .where('board_id', board.id)
          .where('status', 'ready')
          .orderBy('version', 'desc')
          .first()
      : null
    const decision = doc
      ? await PortalFeedback.query()
          .where('board_id', board.id)
          .where('version', doc.version)
          .whereIn('decision', ['approved', 'changes'])
          .orderBy('id', 'desc')
          .first()
      : null
    // Co się zmieniło od poprzedniej wersji (FEAT-1) — klient widzi to samo co zespół.
    const previous = doc ? await previousReady(board.id, doc.version) : null
    const changes = doc && previous ? diffDocs(previous, doc) : null
    const sent = await Asset.query()
      .where('board_id', board.id)
      .whereNotNull('submitted_by')
      .count('* as total')

    return inertia.render(
      'portal/show' as any,
      {
        portal: {
          token: share.token,
          board: { title: board.title },
          owner: { name: owner.fullName?.trim() || owner.email.split('@')[0] },
          brand: await printBrand(owner.id),
          allowUpload: share.allowUpload,
          maxFiles: MAX_FILES,
          submitted: Number(sent[0].$extras.total),
          doc: doc
            ? {
                version: doc.version,
                contentMd: doc.contentMd,
                generatedAt: doc.generatedAt?.toISO() ?? null,
                changes: changes && !changes.empty ? { from: previous!.version, ...changes } : null,
              }
            : null,
          decision: decision
            ? {
                decision: decision.decision,
                name: decision.name,
                createdAt: decision.createdAt?.toISO() ?? null,
              }
            : null,
        },
      } as any
    )
  }

  /** POST /c/:token/materials — pliki, link i/lub notatka od klienta. */
  async materials(ctx: HttpContext) {
    const { params, request, response, session } = ctx
    const found = await this.resolve(String(params.token))
    if (!found) return response.notFound()
    const { share, board, owner, limits } = found
    if (!share.allowUpload) {
      session.flash('error', t('portal.uploadsOff'))
      return response.redirect().back()
    }

    const payload = await request.validateUsing(materialsValidator)
    const files = request.files('files')
    if (files.length > MAX_FILES) {
      session.flash('error', t('portal.tooMany', { max: MAX_FILES }))
      return response.redirect().back()
    }
    const incoming = files.length + (payload.url ? 1 : 0)
    if (incoming === 0 && !payload.note) {
      session.flash('error', t('portal.nothing'))
      return response.redirect().back()
    }
    if (await rateLimited(`portal:${share.id}`, 30, 60 * 60_000)) {
      session.flash('error', t('portal.rateLimited'))
      return response.redirect().back()
    }
    const [{ $extras }] = await Asset.query().where('board_id', board.id).count('* as total')
    if (Number($extras.total) + incoming > limits.materialsPerBoard) {
      session.flash('error', t('billing.materialsLimit', { limit: limits.materialsPerBoard }))
      return response.redirect().back()
    }

    // Deduplikacja plików zwraca istniejący asset — materiałów, które już są na
    // tablicy, portal nie rusza (ani skrzynka, ani notatka właściciela).
    const before = new Set(
      (await Asset.query().where('board_id', board.id).select('id')).map((a) => a.id)
    )
    const stored: Asset[] = []
    for (const file of files) stored.push(await storeUploadedFile(board.id, file, 'upload'))
    if (payload.url) stored.push(await storeLink(board.id, payload.url))
    const created = stored.filter((a, i, all) => !before.has(a.id) && all.indexOf(a) === i)
    for (const asset of created) {
      asset.inbox = true
      asset.submittedBy = payload.name
      if (payload.note) asset.userNote = payload.note
      await asset.save()
    }
    // Sama notatka (albo same duplikaty) trafia do właściciela jako wiadomość.
    if (created.length === 0 && payload.note) {
      await PortalFeedback.create({
        boardId: board.id,
        decision: 'note',
        name: payload.name,
        comment: payload.note,
      })
    }

    await notifyOwner(
      owner,
      'materials',
      { name: payload.name, board: board.title, count: Math.max(created.length, stored.length, 1) },
      absoluteUrl(ctx, `/boards/${board.id}`)
    )
    track(
      'portal_materials',
      { count: created.length, note: Boolean(payload.note) },
      { userId: owner.id, boardId: board.id }
    )
    session.flash('success', 'portal.sent')
    return response.redirect().back()
  }

  /** POST /c/:token/feedback — akceptacja albo prośba o zmiany. */
  async feedback(ctx: HttpContext) {
    const { params, request, response, session } = ctx
    const found = await this.resolve(String(params.token))
    if (!found) return response.notFound()
    const { share, board, owner } = found
    const payload = await request.validateUsing(feedbackValidator)
    const doc = share.showDoc
      ? await DesignDoc.query()
          .where('board_id', board.id)
          .where('version', payload.version)
          .where('status', 'ready')
          .first()
      : null
    if (!doc) {
      session.flash('error', t('portal.noDoc'))
      return response.redirect().back()
    }
    if (await rateLimited(`portal-feedback:${share.id}`, 20, 60 * 60_000)) {
      session.flash('error', t('portal.rateLimited'))
      return response.redirect().back()
    }
    track(
      'portal_feedback',
      { decision: payload.decision, version: doc.version },
      { userId: owner.id, boardId: board.id }
    )
    await PortalFeedback.create({
      boardId: board.id,
      designDocId: doc.id,
      version: doc.version,
      decision: payload.decision,
      name: payload.name,
      comment: payload.comment ?? null,
    })
    await notifyOwner(
      owner,
      payload.decision,
      { name: payload.name, board: board.title, version: doc.version, comment: payload.comment },
      absoluteUrl(ctx, `/boards/${board.id}`)
    )
    session.flash(
      'success',
      payload.decision === 'approved' ? 'portal.approvedThanks' : 'portal.changesThanks'
    )
    return response.redirect().back()
  }
}
