import type { HttpContext } from '@adonisjs/core/http'
import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import Job from '#models/job'
import { providerNotReadyMessage, providerReady } from '#services/ai/provider'
import { hasContent, preflightError, prepareGeneration } from '#services/design/generator'
import { JOB_GENERATE_DESIGN_DOC, enqueue } from '#services/queue'
import {
  designDocVersionValidator,
  estimateValidator,
  exportValidator,
  generateDesignDocValidator,
} from '#validators/design_doc'
import { currentLocale, t } from '#services/i18n'
import { billing } from '#config/billing'
import { entitlementsFor } from '#services/billing/plans'
import {
  InsufficientCreditsError,
  balanceOf,
  ensureAutomaticGrants,
  reserveCredits,
} from '#services/billing/credits'
import { estimateGeneration } from '#services/billing/estimate'
import { renderExport } from '#services/design/exports'
import { trackFor } from '#services/analytics/events'

/**
 * DESIGN.md tablicy: zlecanie generacji, status, wersje, pobieranie.
 * Wszystko wyłącznie dla właściciela tablicy (obcy dostaje 404).
 */
export default class DesignDocsController {
  private async findBoard(userId: number, boardId: string | number) {
    const board = await Board.find(boardId)
    if (!board || board.userId !== userId) return null
    return board
  }

  private async serialize(doc: DesignDoc, withContent: boolean) {
    const job =
      doc.jobId && (doc.status === 'queued' || doc.status === 'running')
        ? await Job.find(doc.jobId)
        : null
    return {
      id: doc.id,
      boardId: doc.boardId,
      version: doc.version,
      status: doc.status,
      error: doc.error,
      model: doc.model,
      promptVersion: doc.promptVersion,
      usage: doc.usage,
      creditsCharged: doc.creditsCharged,
      proMode: doc.proMode,
      hasSpec: doc.spec != null,
      sources: doc.sources,
      createdAt: doc.createdAt?.toISO() ?? null,
      generatedAt: doc.generatedAt?.toISO() ?? null,
      jobId: doc.jobId,
      progress: (job?.payload?.progress as Record<string, unknown> | undefined) ?? null,
      ...(withContent ? { contentMd: doc.contentMd } : {}),
    }
  }

  /** POST /api/boards/:id/design-doc — zleca generację (202) albo zwraca aktualną wersję (200). */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const user = auth.user!
    const board = await this.findBoard(user.id, params.id)
    if (!board) return response.notFound()

    const { force, proMode = false } = await request.validateUsing(generateDesignDocValidator)
    const { limits } = await entitlementsFor(user.id)
    if (proMode && !limits.proReasoning) {
      return response.status(403).json({ message: t('billing.proOnly'), code: 'E_PLAN_FEATURE' })
    }

    if (!providerReady()) {
      return response
        .status(503)
        .json({ message: providerNotReadyMessage(), code: 'E_AI_NOT_READY' })
    }

    const inProgress = await DesignDoc.query()
      .where('board_id', board.id)
      .whereIn('status', ['queued', 'running'])
      .orderBy('version', 'desc')
      .first()
    if (inProgress) {
      return response.status(409).json({
        message: t('doc.inProgress'),
        code: 'E_DESIGN_DOC_IN_PROGRESS',
        data: await this.serialize(inProgress, false),
      })
    }

    const input = await prepareGeneration(board)
    if (!hasContent(input)) {
      return response.status(422).json({
        message: t('doc.emptyBoard'),
        code: 'E_DESIGN_DOC_EMPTY_BOARD',
      })
    }
    const preflight = preflightError(input)
    if (preflight) {
      return response.status(422).json({ message: preflight, code: 'E_DESIGN_DOC_LIMIT' })
    }

    const latest = await DesignDoc.query()
      .where('board_id', board.id)
      .orderBy('version', 'desc')
      .first()

    if (
      !force &&
      latest?.status === 'ready' &&
      latest.inputFingerprint === input.fingerprint &&
      latest.proMode === proMode
    ) {
      return response
        .status(200)
        .json({ data: { doc: await this.serialize(latest, true), reused: true } })
    }

    // Kredyty: szacunek = opłata. Brak środków → 402, zanim cokolwiek powstanie.
    const estimate = billing.enforced ? await estimateGeneration(input, proMode) : null
    if (estimate) {
      await ensureAutomaticGrants(user.id)
      const balance = await balanceOf(user.id)
      if (balance < estimate.credits) {
        return response.status(402).json({
          message: t('billing.insufficient', { needed: estimate.credits, balance }),
          code: 'E_INSUFFICIENT_CREDITS',
          needed: estimate.credits,
          balance,
        })
      }
    }

    const doc = await DesignDoc.create({
      boardId: board.id,
      version: (latest?.version ?? 0) + 1,
      status: 'queued',
      inputFingerprint: input.fingerprint,
      proMode,
    })
    if (estimate) {
      try {
        await reserveCredits(user.id, estimate.credits, { designDocId: doc.id })
      } catch (error) {
        await doc.delete()
        if (error instanceof InsufficientCreditsError) {
          return response.status(402).json({
            message: error.message,
            code: 'E_INSUFFICIENT_CREDITS',
            needed: error.needed,
            balance: error.balance,
          })
        }
        throw error
      }
    }
    const job = await enqueue(JOB_GENERATE_DESIGN_DOC, {
      designDocId: doc.id,
      boardId: board.id,
      // Język użytkownika — komunikaty generacji w tle mówią tym samym językiem.
      locale: currentLocale(),
    })
    doc.jobId = job.id
    await doc.save()
    trackFor(
      ctx,
      'design_doc_requested',
      {
        version: doc.version,
        proMode,
        credits: estimate?.credits ?? 0,
        newMaterials: estimate?.newMaterials ?? input.assets.length,
        materials: input.assets.length,
        force: Boolean(force),
      },
      { boardId: board.id }
    )

    return response
      .status(202)
      .json({ data: { doc: await this.serialize(doc, false), reused: false } })
  }

  /** GET /api/boards/:id/design-doc?version= — najnowsza (lub wskazana) wersja z treścią. */
  async show({ auth, params, request, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id)
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()

    if (!doc && version) return response.notFound()
    if (doc && !(await this.versionVisible(auth.user!.id, board.id, doc.version))) {
      return response
        .status(403)
        .json({ message: t('billing.versionLocked'), code: 'E_PLAN_LIMIT' })
    }
    return response.json({ data: doc ? await this.serialize(doc, true) : null })
  }

  /** GET /api/boards/:id/design-docs — historia wersji (bez treści). */
  async index({ auth, params, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { limits } = await entitlementsFor(auth.user!.id)
    const all = await DesignDoc.query().where('board_id', board.id).orderBy('version', 'desc')
    // Plan Free: widać tylko ostatnie wersje; starsze czekają na przejście na płatny plan.
    const docs = limits.versionsKept == null ? all : all.slice(0, limits.versionsKept)
    return response.json({
      data: await Promise.all(docs.map((d) => this.serialize(d, false))),
      meta: { hiddenVersions: all.length - docs.length },
    })
  }

  /** GET /api/boards/:id/design-doc/download?version= — plik DESIGN.md. */
  async download(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc?.contentMd) return response.notFound()
    if (!(await this.versionVisible(auth.user!.id, board.id, doc.version))) {
      return response
        .status(403)
        .json({ message: t('billing.versionLocked'), code: 'E_PLAN_LIMIT' })
    }

    trackFor(ctx, 'design_md_downloaded', { version: doc.version }, { boardId: board.id })
    response.header('Content-Type', 'text/markdown; charset=utf-8')
    response.header('Content-Disposition', 'attachment; filename="DESIGN.md"')
    response.header('X-Content-Type-Options', 'nosniff')
    return response.send(doc.contentMd)
  }

  /** Czy wersja mieści się w limicie historii planu. */
  private async versionVisible(userId: number, boardId: number, version: number) {
    const { limits } = await entitlementsFor(userId)
    if (limits.versionsKept == null) return true
    const newer = await DesignDoc.query()
      .where('board_id', boardId)
      .where('version', '>', version)
      .count('* as total')
    return Number(newer[0].$extras.total) < limits.versionsKept
  }

  /**
   * GET /api/boards/:id/design-doc/estimate?pro= — koszt następnej generacji w
   * kredytach i saldo. `unchanged: true` = bez zmian od ostatniej wersji (0 kredytów).
   */
  async estimate({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const board = await this.findBoard(user.id, params.id)
    if (!board) return response.notFound()

    const { pro = false } = await estimateValidator.validate(request.qs())
    const input = await prepareGeneration(board)
    const latest = await DesignDoc.query()
      .where('board_id', board.id)
      .orderBy('version', 'desc')
      .first()
    const unchanged =
      latest?.status === 'ready' &&
      latest.inputFingerprint === input.fingerprint &&
      latest.proMode === pro

    await ensureAutomaticGrants(user.id)
    const estimate = await estimateGeneration(input, pro)
    return response.json({
      data: {
        ...estimate,
        credits: billing.enforced ? estimate.credits : 0,
        unchanged,
        balance: await balanceOf(user.id),
        enforced: billing.enforced,
      },
    })
  }

  /** GET /api/boards/:id/design-doc/export?format= — tokeny jako CSS, Tailwind v4 albo JSON (W3C). */
  async export(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { limits } = await entitlementsFor(auth.user!.id)
    if (!limits.exports) {
      return response
        .status(403)
        .json({ message: t('billing.exportsLocked'), code: 'E_PLAN_FEATURE' })
    }

    const { format, version } = await exportValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc) return response.notFound()
    if (!doc.spec) {
      return response
        .status(409)
        .json({ message: t('billing.exportNeedsRegen'), code: 'E_NO_SPEC' })
    }

    const file = renderExport(doc.spec, format)
    trackFor(ctx, 'tokens_exported', { format, version: doc.version }, { boardId: board.id })
    response.header('Content-Type', `${file.type}; charset=utf-8`)
    response.header('Content-Disposition', `attachment; filename="${file.name}"`)
    response.header('X-Content-Type-Options', 'nosniff')
    return response.send(file.body)
  }

  /** GET /api/jobs/:id — status i postęp zadania (tylko właściciel tablicy). */
  async job({ auth, params, response }: HttpContext) {
    const job = await Job.find(params.id)
    const boardId = job?.payload?.boardId as number | undefined
    const board = job && boardId ? await this.findBoard(auth.user!.id, boardId) : null
    if (!job || !board) return response.notFound()

    return response.json({
      data: {
        id: job.id,
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        progress: job.payload.progress ?? null,
        error: job.lastError,
      },
    })
  }
}
