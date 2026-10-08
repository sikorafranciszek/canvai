import { versionVisible } from '#services/design/access'
import type { HttpContext } from '@adonisjs/core/http'
import DesignDoc from '#models/design_doc'
import {
  startGeneration,
  startRevision,
  type StartGenerationResult,
} from '#services/design/generation_service'
import { diffDocs, previousReady } from '#services/design/spec_diff'
import Job from '#models/job'
import { prepareGeneration } from '#services/design/generator'
import {
  changesValidator,
  reviseValidator,
  designDocVersionValidator,
  editDesignDocValidator,
  estimateValidator,
  exportValidator,
  generateDesignDocValidator,
} from '#validators/design_doc'
import { t } from '#services/i18n'
import { billing } from '#config/billing'
import { entitlementsFor } from '#services/billing/plans'
import { balanceOf, ensureAutomaticGrants, releaseAll } from '#services/billing/credits'
import { estimateGeneration } from '#services/billing/estimate'
import { renderExport } from '#services/design/exports'
import { assessQuality } from '#services/design/quality'
import db from '@adonisjs/lucid/services/db'
import { lockBoard } from '#services/design/board_lock'
import { printBrand } from '#services/portal'
import { accessibleBoard } from '#services/board_access'
import { publish } from '#services/board_events'
import { createEditedVersion, SpecEditError } from '#services/design/edit'
import { trackFor } from '#services/analytics/events'

/**
 * DESIGN.md tablicy: zlecanie generacji, status, wersje, pobieranie.
 * Wszystko wyłącznie dla właściciela tablicy (obcy dostaje 404).
 */
/** Kolumny listy wersji — bez `content_md` i `spec` (duże). */
const DESIGN_DOC_LIST_COLUMNS = [
  'id',
  'board_id',
  'version',
  'status',
  'error',
  'usage',
  'credits_charged',
  'pro_mode',
  'sources',
  'created_at',
  'generated_at',
  'job_id',
  'edited_from_version',
]

export default class DesignDocsController {
  /** Tablica, do której użytkownik ma dostęp (`view` albo `edit`). Rozliczenia — konto właściciela. */

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
      usage: doc.usage,
      creditsCharged: doc.creditsCharged,
      proMode: doc.proMode,
      hasSpec: (doc.$extras.has_spec as boolean | undefined) ?? doc.spec != null,
      sources: doc.sources,
      createdAt: doc.createdAt?.toISO() ?? null,
      generatedAt: doc.generatedAt?.toISO() ?? null,
      jobId: doc.jobId,
      progress: (job?.payload?.progress as Record<string, unknown> | undefined) ?? null,
      editedFromVersion: doc.editedFromVersion ?? null,
      instruction: doc.instruction ?? null,
      revisedSection: doc.revisedSection ?? null,
      ...(withContent ? { contentMd: doc.contentMd } : {}),
      ...(withContent && doc.spec && doc.status === 'ready'
        ? {
            quality: assessQuality(doc.spec, doc.sources?.length ?? 0),
            tokens: {
              colors: doc.spec.colors.map((c) => ({
                token: c.token,
                name: c.name,
                hex: c.hex,
                role: c.role,
                assumed: c.assumed,
                confirmed: Boolean(c.confirmed),
              })),
              families: doc.spec.typography.families.map((f) => ({
                token: f.token,
                name: f.name,
                role: f.role,
                assumed: f.assumed,
                confirmed: Boolean(f.confirmed),
              })),
              radii: doc.spec.radii,
            },
          }
        : {}),
    }
  }

  /** POST /api/boards/:id/design-doc/edit — poprawione tokeny jako nowa wersja (bez AI i kredytów). */
  async edit(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()
    const { version, ...edits } = await request.validateUsing(editDesignDocValidator)

    const busy = await DesignDoc.query()
      .where('board_id', board.id)
      .whereIn('status', ['queued', 'running'])
      .first()
    if (busy) {
      return response
        .status(409)
        .json({ message: t('doc.inProgress'), code: 'E_DESIGN_DOC_IN_PROGRESS' })
    }
    const base = await DesignDoc.query()
      .where('board_id', board.id)
      .where('version', version)
      .first()
    if (!base) return response.notFound()
    if (!(await this.versionVisible(board.userId, board.id, base.version))) {
      return response
        .status(403)
        .json({ message: t('billing.versionLocked'), code: 'E_PLAN_LIMIT' })
    }
    try {
      const doc = await createEditedVersion(base, edits)
      trackFor(
        ctx,
        'design_doc_edited',
        {
          from: base.version,
          version: doc.version,
          colors: edits.colors?.length ?? 0,
          families: edits.families?.length ?? 0,
          radii: edits.radii?.length ?? 0,
        },
        { boardId: board.id }
      )
      // Autor edycji ma już nową wersję — powiadomienie tylko dla pozostałych (UX-7).
      publish(
        board.id,
        'doc',
        { version: doc.version, status: 'ready' },
        request.header('x-client-id'),
        auth.user!.id
      )
      return response.status(201).json({ data: await this.serialize(doc, true) })
    } catch (error) {
      if (error instanceof SpecEditError) {
        return response.status(422).json({ message: error.message, code: 'E_EDIT_INVALID' })
      }
      throw error
    }
  }

  /** Wynik startu generacji / poprawki → odpowiedź HTTP (wspólne dla store i revise). */
  private async respondToStart(ctx: HttpContext, result: StartGenerationResult) {
    const { response } = ctx
    switch (result.kind) {
      case 'plan':
        return response.status(403).json({ message: result.message, code: 'E_PLAN_FEATURE' })
      case 'unavailable':
        return response.status(503).json({ message: result.message, code: 'E_AI_NOT_READY' })
      case 'busy':
        return response.status(409).json({
          message: t('doc.inProgress'),
          code: 'E_DESIGN_DOC_IN_PROGRESS',
          data: await this.serialize(result.doc, false),
        })
      case 'empty':
        return response
          .status(422)
          .json({ message: result.message, code: 'E_DESIGN_DOC_EMPTY_BOARD' })
      case 'limit':
        return response.status(422).json({ message: result.message, code: 'E_DESIGN_DOC_LIMIT' })
      case 'budget':
        return response.status(429).json({ message: result.message, code: 'E_AI_BUDGET' })
      case 'credits':
        return response.status(402).json({
          message: result.message,
          code: 'E_INSUFFICIENT_CREDITS',
          needed: result.needed,
          balance: result.balance,
        })
      case 'reused':
        return response
          .status(200)
          .json({ data: { doc: await this.serialize(result.doc, true), reused: true } })
      case 'queued':
        return response
          .status(202)
          .json({ data: { doc: await this.serialize(result.doc, false), reused: false } })
    }
  }

  /**
   * POST /api/boards/:id/design-doc/revise — poprawka poleceniem albo
   * regeneracja jednej sekcji (FEAT-2) jako nowa wersja; cena `costs.revision`.
   */
  async revise(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()
    const { version, instruction, section } = await request.validateUsing(reviseValidator)
    const result = await startRevision(board, auth.user!.id, { version, instruction, section })
    if (result.kind === 'queued') {
      trackFor(
        ctx,
        'design_doc_revision',
        {
          from: version,
          version: result.doc.version,
          section: section ?? null,
          credits: result.credits,
        },
        { boardId: board.id }
      )
    }
    return this.respondToStart(ctx, result)
  }

  /** POST /api/boards/:id/design-doc — zleca generację (202) albo zwraca aktualną wersję (200). */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const user = auth.user!
    const board = await accessibleBoard(user.id, params.id, 'edit')
    if (!board) return response.notFound()

    const { force, proMode = false } = await request.validateUsing(generateDesignDocValidator)
    const result = await startGeneration(board, user.id, { force, proMode })
    if (result.kind === 'queued') {
      trackFor(
        ctx,
        'design_doc_requested',
        {
          version: result.doc.version,
          proMode,
          credits: result.credits,
          newMaterials: result.newMaterials,
          materials: result.materials,
          force: Boolean(force),
        },
        { boardId: board.id }
      )
    }
    return this.respondToStart(ctx, result)
  }

  /**
   * POST /api/boards/:id/design-doc/cancel — anuluje generację w toku (UX-11).
   * Zadanie w kolejce nie ruszy; trwające zatrzyma się na najbliższym punkcie
   * kontrolnym. Rezerwacja kredytów wraca w całości (gotowe analizy zostają w
   * cache — ponowna generacja ich nie powtórzy).
   */
  async cancel(ctx: HttpContext) {
    const { auth, params, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()

    const cancelled = await db.transaction(async (trx) => {
      await lockBoard(trx, board.id)
      const doc = await DesignDoc.query({ client: trx })
        .where('board_id', board.id)
        .whereIn('status', ['queued', 'running'])
        .first()
      if (!doc) return null
      await DesignDoc.query({ client: trx })
        .where('id', doc.id)
        .update({ status: 'failed', error: t('doc.cancelled') })
      if (doc.jobId) {
        await trx.from('jobs').where('id', doc.jobId).where('status', 'queued').update({
          status: 'failed',
          last_error: 'cancelled',
          locked_at: null,
          locked_by: null,
          updated_at: new Date(),
        })
      }
      return doc
    })
    if (!cancelled) return response.notFound()

    await releaseAll({ designDocId: cancelled.id }, 'generation cancelled')
    trackFor(ctx, 'design_doc_cancelled', { version: cancelled.version }, { boardId: board.id })
    publish(board.id, 'doc', { version: cancelled.version, status: 'failed' })
    await cancelled.refresh()
    return response.json({ data: await this.serialize(cancelled, false) })
  }

  /** GET /api/boards/:id/design-doc?version= — najnowsza (lub wskazana) wersja z treścią. */
  async show({ auth, params, request, response }: HttpContext) {
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id)
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()

    if (!doc && version) return response.notFound()
    if (doc && !(await this.versionVisible(board.userId, board.id, doc.version))) {
      return response
        .status(403)
        .json({ message: t('billing.versionLocked'), code: 'E_PLAN_LIMIT' })
    }
    return response.json({ data: doc ? await this.serialize(doc, true) : null })
  }

  /**
   * GET /api/boards/:id/design-doc/changes?version=&from= — zmiany „po ludzku”
   * między wersjami (FEAT-1): tokeny było → jest i przyczyny z danych tablicy.
   * Domyślnie najnowsza gotowa wersja wobec poprzedniej gotowej.
   */
  async changes({ auth, params, request, response }: HttpContext) {
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    const { version, from } = await changesValidator.validate(request.qs())
    const ready = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const to = version
      ? await ready.clone().where('version', version).first()
      : await ready.clone().orderBy('version', 'desc').first()
    if (!to) return response.notFound()
    const base = from
      ? await ready.clone().where('version', from).first()
      : await previousReady(board.id, to.version)
    if (!base) return response.json({ data: null })
    for (const v of [to.version, base.version]) {
      if (!(await versionVisible(board.userId, board.id, v))) {
        return response
          .status(403)
          .json({ message: t('billing.versionLocked'), code: 'E_PLAN_LIMIT' })
      }
    }
    return response.json({
      data: { from: base.version, to: to.version, changes: diffDocs(base, to) },
    })
  }

  /** GET /api/boards/:id/design-docs — historia wersji (bez treści). */
  async index({ auth, params, response }: HttpContext) {
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { limits } = await entitlementsFor(board.userId)
    // Plan Free: widać tylko ostatnie wersje; starsze czekają na przejście na płatny plan.
    // Limit i liczba w SQL, bez treści i specyfikacji (ARC-2).
    const query = DesignDoc.query()
      .where('board_id', board.id)
      .select(...DESIGN_DOC_LIST_COLUMNS, db.raw('(spec is not null) as has_spec'))
      .orderBy('version', 'desc')
    if (limits.versionsKept != null) query.limit(limits.versionsKept)
    const [docs, total] = await Promise.all([
      query,
      DesignDoc.query().where('board_id', board.id).count('* as total'),
    ])
    return response.json({
      data: await Promise.all(docs.map((d) => this.serialize(d, false))),
      meta: { hiddenVersions: Number(total[0].$extras.total) - docs.length },
    })
  }

  /** GET /api/boards/:id/design-doc/download?version= — plik DESIGN.md. */
  async download(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc?.contentMd) return response.notFound()
    if (!(await this.versionVisible(board.userId, board.id, doc.version))) {
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

  /** GET /boards/:id/design-doc/print?version= — DESIGN.md do druku / zapisu jako PDF. */
  async print(ctx: HttpContext) {
    const { auth, params, request, response, inertia } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    const { version } = await designDocVersionValidator.validate(request.qs())
    const query = DesignDoc.query().where('board_id', board.id).where('status', 'ready')
    const doc = version
      ? await query.where('version', version).first()
      : await query.orderBy('version', 'desc').first()
    if (!doc?.contentMd) return response.notFound()
    if (!(await this.versionVisible(board.userId, board.id, doc.version))) {
      return response.redirect().toPath('/billing')
    }
    trackFor(ctx, 'design_doc_printed', { version: doc.version }, { boardId: board.id })
    return inertia.render(
      'print/design_doc' as any,
      {
        doc: {
          title: board.title,
          version: doc.version,
          contentMd: doc.contentMd,
          generatedAt: doc.generatedAt?.toISO() ?? null,
        },
        preparedBy: await printBrand(board.userId),
        backHref: `/boards/${board.id}`,
      } as any
    )
  }

  /** Czy wersja mieści się w limicie historii planu (wspólna reguła z API/MCP). */
  private versionVisible(userId: number, boardId: number, version: number) {
    return versionVisible(userId, boardId, version)
  }

  /**
   * GET /api/boards/:id/design-doc/estimate?pro= — koszt następnej generacji w
   * kredytach i saldo. `unchanged: true` = bez zmian od ostatniej wersji (0 kredytów).
   */
  async estimate({ auth, params, request, response }: HttpContext) {
    const user = auth.user!
    const board = await accessibleBoard(user.id, params.id, 'edit')
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

    await ensureAutomaticGrants(board.userId)
    const estimate = await estimateGeneration(input, pro)
    return response.json({
      data: {
        ...estimate,
        credits: billing.enforced ? estimate.credits : 0,
        unchanged,
        balance: await balanceOf(board.userId),
        enforced: billing.enforced,
      },
    })
  }

  /** GET /api/boards/:id/design-doc/export?format= — tokeny jako CSS, Tailwind v4 albo JSON (W3C). */
  async export(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()

    const { limits } = await entitlementsFor(board.userId)
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
    const board = job && boardId ? await accessibleBoard(auth.user!.id, boardId) : null
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
