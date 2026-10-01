import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { billing, costs } from '#config/billing'
import DesignDoc from '#models/design_doc'
import DesignPreview from '#models/design_preview'
import { providerNotReadyMessage, providerReady } from '#services/ai/provider'
import {
  InsufficientCreditsError,
  balanceOf,
  ensureAutomaticGrants,
  reserveCredits,
} from '#services/billing/credits'
import { JOB_GENERATE_PREVIEW, enqueue } from '#services/queue'
import { currentLocale, t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'
import { aiBudgetDenial, countGeneration } from '#services/ops/ai_budget'
import { boardAccess, type BoardAction } from '#services/board_access'

const previewValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
    force: vine.boolean().optional(),
  })
)

/**
 * Twarde nagłówki podglądu: bez skryptów (CSP `sandbox` bez `allow-scripts`),
 * jedyne zewnętrzne zasoby to Google Fonts, osadzanie tylko w aplikacji.
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox',
].join('; ')

/** Podgląd UI z wersji DESIGN.md (przykładowa strona HTML), rozliczany kredytami. */
export default class DesignPreviewsController {
  private async findBoard(userId: number, boardId: string | number, action: BoardAction = 'view') {
    return (await boardAccess(userId, boardId, action))?.board ?? null
  }

  private async findDoc(boardId: number, version?: number) {
    const query = DesignDoc.query().where('board_id', boardId).where('status', 'ready')
    return version
      ? query.where('version', version).first()
      : query.orderBy('version', 'desc').first()
  }

  private serialize(preview: DesignPreview, boardId: number, version: number) {
    return {
      id: preview.id,
      version,
      status: preview.status,
      error: preview.error,
      creditsCharged: preview.creditsCharged,
      createdAt: preview.createdAt?.toISO() ?? null,
      generatedAt: preview.generatedAt?.toISO() ?? null,
      url: preview.status === 'ready' ? `/boards/${boardId}/previews/${preview.id}` : null,
    }
  }

  /** GET /api/boards/:id/design-doc/preview?version= — najnowszy podgląd wersji i koszt nowego. */
  async show({ auth, params, request, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    const { version } = await previewValidator.validate(request.qs())
    const doc = await this.findDoc(board.id, version)
    const preview = doc
      ? await DesignPreview.query().where('design_doc_id', doc.id).orderBy('id', 'desc').first()
      : null
    return response.json({
      data: preview && doc ? this.serialize(preview, board.id, doc.version) : null,
      meta: { cost: billing.enforced ? costs.preview : 0, hasSpec: Boolean(doc?.spec) },
    })
  }

  /** POST /api/boards/:id/design-doc/preview — zleca podgląd (202) albo zwraca gotowy (200). */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const user = auth.user!
    const board = await this.findBoard(user.id, params.id, 'edit')
    if (!board) return response.notFound()
    const { version, force } = await previewValidator.validate(request.body())

    if (!providerReady()) {
      return response
        .status(503)
        .json({ message: providerNotReadyMessage(), code: 'E_AI_NOT_READY' })
    }
    const doc = await this.findDoc(board.id, version)
    if (!doc)
      return response.status(422).json({ message: t('preview.needsReady'), code: 'E_NO_DOC' })
    if (!doc.spec)
      return response.status(409).json({ message: t('preview.needsSpec'), code: 'E_NO_SPEC' })

    const latest = await DesignPreview.query()
      .where('design_doc_id', doc.id)
      .orderBy('id', 'desc')
      .first()
    if (latest && (latest.status === 'queued' || latest.status === 'running')) {
      return response.status(409).json({
        message: t('preview.inProgress'),
        code: 'E_PREVIEW_IN_PROGRESS',
        data: this.serialize(latest, board.id, doc.version),
      })
    }
    if (latest?.status === 'ready' && !force) {
      return response.json({ data: this.serialize(latest, board.id, doc.version), reused: true })
    }

    const denial = await aiBudgetDenial(user.id)
    if (denial) return response.status(429).json({ message: denial, code: 'E_AI_BUDGET' })

    if (billing.enforced) {
      await ensureAutomaticGrants(board.userId)
      const balance = await balanceOf(board.userId)
      if (balance < costs.preview) {
        return response.status(402).json({
          message: t('billing.insufficient', { needed: costs.preview, balance }),
          code: 'E_INSUFFICIENT_CREDITS',
        })
      }
    }

    const preview = await DesignPreview.create({ designDocId: doc.id, status: 'queued' })
    if (billing.enforced) {
      try {
        await reserveCredits(board.userId, costs.preview, { designPreviewId: preview.id })
      } catch (error) {
        await preview.delete()
        if (error instanceof InsufficientCreditsError) {
          return response
            .status(402)
            .json({ message: error.message, code: 'E_INSUFFICIENT_CREDITS' })
        }
        throw error
      }
    }
    await countGeneration(user.id)
    const job = await enqueue(JOB_GENERATE_PREVIEW, {
      previewId: preview.id,
      boardId: board.id,
      locale: currentLocale(),
    })
    preview.jobId = job.id
    await preview.save()
    trackFor(
      ctx,
      'preview_requested',
      { version: doc.version, force: Boolean(force) },
      { boardId: board.id }
    )
    return response
      .status(202)
      .json({ data: this.serialize(preview, board.id, doc.version), reused: false })
  }

  /** GET /boards/:id/previews/:previewId — sam HTML (iframe w aplikacji, nowa karta, pobranie). */
  async html({ auth, params, request, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    const preview = await DesignPreview.find(params.previewId)
    const doc = preview ? await DesignDoc.find(preview.designDocId) : null
    if (!preview?.html || !doc || doc.boardId !== board.id) return response.notFound()

    response.header('Content-Type', 'text/html; charset=utf-8')
    response.header('Content-Security-Policy', PREVIEW_CSP)
    response.header('X-Content-Type-Options', 'nosniff')
    response.header('Referrer-Policy', 'no-referrer')
    // Globalny X-Frame-Options (Shield) blokowałby iframe w samej aplikacji.
    response.header('X-Frame-Options', 'SAMEORIGIN')
    response.header('Cache-Control', 'private, no-store')
    if (request.qs().download) {
      response.header('Content-Disposition', `attachment; filename="preview-v${doc.version}.html"`)
    }
    return response.send(preview.html)
  }
}
