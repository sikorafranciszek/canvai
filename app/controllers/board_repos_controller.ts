import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import BoardRepo from '#models/board_repo'
import DesignDoc from '#models/design_doc'
import { accessibleBoard } from '#services/board_access'
import { entitlementsFor } from '#services/billing/plans'
import { enqueue, JOB_GITHUB_SYNC } from '#services/queue'
import {
  encryptToken,
  GithubSyncError,
  REPO_PATTERN,
  verifyRepoAccess,
} from '#services/github_sync'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const repoValidator = vine.compile(
  vine.object({
    repo: vine.string().trim().regex(REPO_PATTERN),
    token: vine.string().trim().minLength(20).maxLength(400).optional(),
    baseBranch: vine
      .string()
      .trim()
      .regex(/^[\w./-]{1,200}$/)
      .optional(),
    directory: vine
      .string()
      .trim()
      .regex(/^[\w./-]{0,200}$/)
      .optional(),
    autoOnApprove: vine.boolean().optional(),
  })
)

const syncValidator = vine.compile(
  vine.object({ version: vine.number().withoutDecimals().positive().optional() })
)

function serialize(row: BoardRepo | null) {
  if (!row) return null
  return {
    repo: row.repo,
    baseBranch: row.baseBranch,
    directory: row.directory,
    autoOnApprove: row.autoOnApprove,
    lastVersion: row.lastVersion,
    lastPrUrl: row.lastPrUrl,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISO() ?? null,
  }
}

/**
 * Repozytorium GitHub tablicy (FEAT-5): połączenie (token szyfrowany, nigdy
 * nie wraca do klienta) i pull request z wersją DESIGN.md. Plany z API.
 */
export default class BoardReposController {
  /** GET /api/boards/:id/repo */
  async show({ auth, params, response }: HttpContext) {
    const board = await accessibleBoard(auth.user!.id, params.id)
    if (!board) return response.notFound()
    return response.json({ data: serialize(await BoardRepo.findBy('boardId', board.id)) })
  }

  /** PUT /api/boards/:id/repo — połączenie albo zmiana ustawień. */
  async update(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()
    const { limits } = await entitlementsFor(board.userId)
    if (!limits.api) {
      return response.status(403).json({ message: t('github.planOnly'), code: 'E_PLAN_FEATURE' })
    }
    const input = await request.validateUsing(repoValidator)
    const existing = await BoardRepo.findBy('boardId', board.id)
    if (!input.token && (!existing || existing.repo !== input.repo)) {
      return response.status(422).json({ message: t('github.tokenRequired'), code: 'E_GITHUB' })
    }
    let defaultBranch: string | null = null
    if (input.token) {
      try {
        defaultBranch = await verifyRepoAccess(input.repo, input.token)
      } catch (error) {
        if (error instanceof GithubSyncError) {
          return response.status(422).json({ message: error.message, code: 'E_GITHUB' })
        }
        throw error
      }
    }
    const row = existing ?? new BoardRepo()
    row.boardId = board.id
    row.repo = input.repo
    row.baseBranch = input.baseBranch || existing?.baseBranch || defaultBranch || 'main'
    row.directory = input.directory ?? existing?.directory ?? ''
    row.autoOnApprove = input.autoOnApprove ?? existing?.autoOnApprove ?? true
    if (input.token) row.token = encryptToken(input.token)
    row.lastError = null
    await row.save()
    trackFor(ctx, 'github_connected', { auto: row.autoOnApprove }, { boardId: board.id })
    return response.json({ data: serialize(row) })
  }

  /** DELETE /api/boards/:id/repo */
  async destroy({ auth, params, response }: HttpContext) {
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()
    await BoardRepo.query().where('board_id', board.id).delete()
    return response.json({ data: null })
  }

  /**
   * POST /api/boards/:id/repo/sync — pull request z wersją (domyślnie
   * zaakceptowaną, a bez akceptacji najnowszą gotową). Asynchronicznie.
   */
  async sync(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await accessibleBoard(auth.user!.id, params.id, 'edit')
    if (!board) return response.notFound()
    const row = await BoardRepo.findBy('boardId', board.id)
    if (!row) return response.status(404).json({ message: t('github.notConnected') })
    const { version } = await request.validateUsing(syncValidator)
    const target = version ?? board.approvedVersion
    const doc = await DesignDoc.query()
      .where('board_id', board.id)
      .where('status', 'ready')
      .if(target != null, (q) => q.where('version', target!))
      .orderBy('version', 'desc')
      .first()
    if (!doc) return response.status(422).json({ message: t('doc.revisionNotReady') })
    await enqueue(JOB_GITHUB_SYNC, { boardId: board.id, version: doc.version })
    trackFor(ctx, 'github_sync_requested', { version: doc.version }, { boardId: board.id })
    return response.status(202).json({ data: { version: doc.version } })
  }
}
