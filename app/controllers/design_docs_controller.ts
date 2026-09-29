import type { HttpContext } from '@adonisjs/core/http'
import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import Job from '#models/job'
import { providerNotReadyMessage, providerReady } from '#services/ai/provider'
import { hasContent, preflightError, prepareGeneration } from '#services/design/generator'
import { JOB_GENERATE_DESIGN_DOC, enqueue } from '#services/queue'
import { designDocVersionValidator, generateDesignDocValidator } from '#validators/design_doc'
import { currentLocale, t } from '#services/i18n'

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
      sources: doc.sources,
      createdAt: doc.createdAt?.toISO() ?? null,
      generatedAt: doc.generatedAt?.toISO() ?? null,
      jobId: doc.jobId,
      progress: (job?.payload?.progress as Record<string, unknown> | undefined) ?? null,
      ...(withContent ? { contentMd: doc.contentMd } : {}),
    }
  }

  /** POST /api/boards/:id/design-doc — zleca generację (202) albo zwraca aktualną wersję (200). */
  async store({ auth, params, request, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { force } = await request.validateUsing(generateDesignDocValidator)

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

    if (!force && latest?.status === 'ready' && latest.inputFingerprint === input.fingerprint) {
      return response
        .status(200)
        .json({ data: { doc: await this.serialize(latest, true), reused: true } })
    }

    const doc = await DesignDoc.create({
      boardId: board.id,
      version: (latest?.version ?? 0) + 1,
      status: 'queued',
      inputFingerprint: input.fingerprint,
    })
    const job = await enqueue(JOB_GENERATE_DESIGN_DOC, {
      designDocId: doc.id,
      boardId: board.id,
      // Język użytkownika — komunikaty generacji w tle mówią tym samym językiem.
      locale: currentLocale(),
    })
    doc.jobId = job.id
    await doc.save()

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
    return response.json({ data: doc ? await this.serialize(doc, true) : null })
  }

  /** GET /api/boards/:id/design-docs — historia wersji (bez treści). */
  async index({ auth, params, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const docs = await DesignDoc.query().where('board_id', board.id).orderBy('version', 'desc')
    return response.json({ data: await Promise.all(docs.map((d) => this.serialize(d, false))) })
  }

  /** GET /api/boards/:id/design-doc/download?version= — plik DESIGN.md. */
  async download({ auth, params, request, response }: HttpContext) {
    const board = await this.findBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc?.contentMd) return response.notFound()

    response.header('Content-Type', 'text/markdown; charset=utf-8')
    response.header('Content-Disposition', 'attachment; filename="DESIGN.md"')
    response.header('X-Content-Type-Options', 'nosniff')
    return response.send(doc.contentMd)
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
