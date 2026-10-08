import db from '@adonisjs/lucid/services/db'
import type Board from '#models/board'
import DesignDoc from '#models/design_doc'
import type { RevisableSection } from '#services/ai/types'
import { billing, costs } from '#config/billing'
import { providerNotReadyMessage, providerReady } from '#services/ai/provider'
import {
  InsufficientCreditsError,
  balanceOf,
  ensureAutomaticGrants,
  reserveCredits,
} from '#services/billing/credits'
import { estimateGeneration } from '#services/billing/estimate'
import { entitlementsFor } from '#services/billing/plans'
import { lockBoard } from '#services/design/board_lock'
import { hasContent, preflightError, prepareGeneration } from '#services/design/generator'
import { currentLocale, t } from '#services/i18n'
import { aiBudgetDenial, claimGenerationSlot, releaseGenerationSlot } from '#services/ops/ai_budget'
import { JOB_GENERATE_DESIGN_DOC, enqueue } from '#services/queue'

/**
 * Start generacji DESIGN.md (ARC-3) — jedna ścieżka dla UI, przyszłego REST/MCP
 * i testów. Kontroler zamienia wynik na odpowiedź HTTP.
 *
 * Kolejność: plan i dostawca → generacja w toku → treść tablicy → bez zmian
 * (zwrot gotowej wersji) → dzienne limity → kredyty → JEDNA transakcja pod
 * blokadą tablicy (DAT-2): nowa wersja, rezerwacja kredytów i zadanie.
 */

export type StartGenerationResult =
  | { kind: 'queued'; doc: DesignDoc; credits: number; newMaterials: number; materials: number }
  | { kind: 'reused'; doc: DesignDoc }
  | { kind: 'busy'; doc: DesignDoc }
  | { kind: 'plan'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'limit'; message: string }
  | { kind: 'budget'; message: string }
  | { kind: 'credits'; message: string; needed: number; balance: number }
  | { kind: 'approved'; message: string; version: number }

/**
 * Nowa wersja ponad zaakceptowaną (FEAT-4) wymaga potwierdzenia — klient
 * zaakceptował kontrakt, a REST v1/MCP dalej serwują zaakceptowaną wersję.
 */
function approvalGuard(board: Board, overApproved?: boolean): StartGenerationResult | null {
  if (board.approvedVersion == null || overApproved) return null
  return {
    kind: 'approved',
    message: t('doc.overApproved', { version: board.approvedVersion }),
    version: board.approvedVersion,
  }
}

export async function startGeneration(
  board: Board,
  requesterId: number,
  opts: { force?: boolean; proMode?: boolean; overApproved?: boolean }
): Promise<StartGenerationResult> {
  const proMode = Boolean(opts.proMode)
  const { limits } = await entitlementsFor(board.userId)
  if (proMode && !limits.proReasoning) return { kind: 'plan', message: t('billing.proOnly') }
  if (!providerReady()) return { kind: 'unavailable', message: providerNotReadyMessage() }

  const inProgress = await DesignDoc.query()
    .where('board_id', board.id)
    .whereIn('status', ['queued', 'running'])
    .orderBy('version', 'desc')
    .first()
  if (inProgress) return { kind: 'busy', doc: inProgress }

  const input = await prepareGeneration(board)
  if (!hasContent(input)) return { kind: 'empty', message: t('doc.emptyBoard') }
  const preflight = preflightError(input)
  if (preflight) return { kind: 'limit', message: preflight }

  const latest = await DesignDoc.query()
    .where('board_id', board.id)
    .orderBy('version', 'desc')
    .first()
  if (
    !opts.force &&
    latest?.status === 'ready' &&
    latest.inputFingerprint === input.fingerprint &&
    latest.proMode === proMode
  ) {
    return { kind: 'reused', doc: latest }
  }
  const guarded = approvalGuard(board, opts.overApproved)
  if (guarded) return guarded

  // Bezpieczniki kosztów (dzienne limity) — przed rezerwacją kredytów.
  const denial = (await aiBudgetDenial(requesterId)) ?? (await claimGenerationSlot(requesterId))
  if (denial) return { kind: 'budget', message: denial }

  // Kredyty: szacunek = opłata. Brak środków → odmowa, zanim cokolwiek powstanie.
  const estimate = billing.enforced ? await estimateGeneration(input, proMode) : null
  if (estimate) {
    await ensureAutomaticGrants(board.userId)
    const balance = await balanceOf(board.userId)
    if (balance < estimate.credits) {
      await releaseGenerationSlot(requesterId)
      return {
        kind: 'credits',
        message: t('billing.insufficient', { needed: estimate.credits, balance }),
        needed: estimate.credits,
        balance,
      }
    }
  }

  let outcome: { kind: 'ok'; doc: DesignDoc } | { kind: 'busy'; doc: DesignDoc }
  try {
    outcome = await db.transaction(async (trx) => {
      await lockBoard(trx, board.id)
      const running = await DesignDoc.query({ client: trx })
        .where('board_id', board.id)
        .whereIn('status', ['queued', 'running'])
        .first()
      if (running) return { kind: 'busy' as const, doc: running }
      const top = await DesignDoc.query({ client: trx })
        .where('board_id', board.id)
        .max('version as v')
      const created = await DesignDoc.create(
        {
          boardId: board.id,
          version: Number(top[0].$extras.v ?? 0) + 1,
          status: 'queued',
          inputFingerprint: input.fingerprint,
          proMode,
        },
        { client: trx }
      )
      if (estimate) {
        await reserveCredits(board.userId, estimate.credits, { designDocId: created.id }, trx)
      }
      const job = await enqueue(
        JOB_GENERATE_DESIGN_DOC,
        {
          designDocId: created.id,
          boardId: board.id,
          // Język zlecającego — komunikaty generacji w tle mówią tym samym językiem.
          locale: currentLocale(),
        },
        trx
      )
      created.jobId = job.id
      await created.save()
      return { kind: 'ok' as const, doc: created }
    })
  } catch (error) {
    await releaseGenerationSlot(requesterId)
    if (error instanceof InsufficientCreditsError) {
      return {
        kind: 'credits',
        message: error.message,
        needed: error.needed,
        balance: error.balance,
      }
    }
    throw error
  }
  if (outcome.kind === 'busy') {
    await releaseGenerationSlot(requesterId)
    return outcome
  }
  return {
    kind: 'queued',
    doc: outcome.doc,
    credits: estimate?.credits ?? 0,
    newMaterials: estimate?.newMaterials ?? input.assets.length,
    materials: input.assets.length,
  }
}

/**
 * Poprawka poleceniem / regeneracja sekcji (FEAT-2): nowa wersja liczona w
 * kolejce tak jak generacja (postęp, anulowanie, zwrot przy błędzie), ale bez
 * nowych analiz i za stałą, niższą cenę (`costs.revision`).
 */
export async function startRevision(
  board: Board,
  requesterId: number,
  opts: {
    version: number
    instruction: string
    section?: RevisableSection
    overApproved?: boolean
  }
): Promise<StartGenerationResult> {
  if (!providerReady()) return { kind: 'unavailable', message: providerNotReadyMessage() }
  const base = await DesignDoc.query()
    .where('board_id', board.id)
    .where('version', opts.version)
    .first()
  if (!base || base.status !== 'ready') return { kind: 'limit', message: t('doc.revisionNotReady') }
  if (!base.spec) return { kind: 'limit', message: t('doc.revisionNoBase') }

  const inProgress = await DesignDoc.query()
    .where('board_id', board.id)
    .whereIn('status', ['queued', 'running'])
    .first()
  if (inProgress) return { kind: 'busy', doc: inProgress }
  const guarded = approvalGuard(board, opts.overApproved)
  if (guarded) return guarded

  const denial = (await aiBudgetDenial(requesterId)) ?? (await claimGenerationSlot(requesterId))
  if (denial) return { kind: 'budget', message: denial }

  const credits = billing.enforced ? costs.revision : 0
  if (credits) {
    await ensureAutomaticGrants(board.userId)
    const balance = await balanceOf(board.userId)
    if (balance < credits) {
      await releaseGenerationSlot(requesterId)
      return {
        kind: 'credits',
        message: t('billing.insufficient', { needed: credits, balance }),
        needed: credits,
        balance,
      }
    }
  }

  let outcome: { kind: 'ok'; doc: DesignDoc } | { kind: 'busy'; doc: DesignDoc }
  try {
    outcome = await db.transaction(async (trx) => {
      await lockBoard(trx, board.id)
      const running = await DesignDoc.query({ client: trx })
        .where('board_id', board.id)
        .whereIn('status', ['queued', 'running'])
        .first()
      if (running) return { kind: 'busy' as const, doc: running }
      const top = await DesignDoc.query({ client: trx })
        .where('board_id', board.id)
        .max('version as v')
      const created = await DesignDoc.create(
        {
          boardId: board.id,
          version: Number(top[0].$extras.v ?? 0) + 1,
          status: 'queued',
          proMode: base.proMode,
          editedFromVersion: base.version,
          instruction: opts.instruction,
          revisedSection: opts.section ?? null,
        },
        { client: trx }
      )
      if (credits) await reserveCredits(board.userId, credits, { designDocId: created.id }, trx)
      const job = await enqueue(
        JOB_GENERATE_DESIGN_DOC,
        { designDocId: created.id, boardId: board.id, locale: currentLocale() },
        trx
      )
      created.jobId = job.id
      await created.save()
      return { kind: 'ok' as const, doc: created }
    })
  } catch (error) {
    await releaseGenerationSlot(requesterId)
    if (error instanceof InsufficientCreditsError) {
      return {
        kind: 'credits',
        message: error.message,
        needed: error.needed,
        balance: error.balance,
      }
    }
    throw error
  }
  if (outcome.kind === 'busy') {
    await releaseGenerationSlot(requesterId)
    return outcome
  }
  return { kind: 'queued', doc: outcome.doc, credits, newMaterials: 0, materials: 0 }
}
