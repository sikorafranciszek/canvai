import { DateTime } from 'luxon'
import Asset from '#models/asset'
import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import db from '@adonisjs/lucid/services/db'
import { lockBoard } from '#services/design/board_lock'
import { normalizeHex } from '#services/ai/schemas'
import { whiteLabelName, withPlanFooter } from '#services/design/generator'
import { renderDesignMd } from '#services/design/renderer'
import { cssLength, type DesignSpec } from '#services/design/spec'

/**
 * Ręczna edycja tokenów: zmiana koloru, fontu albo promienia (i potwierdzenie
 * założeń †) tworzy NOWĄ wersję DESIGN.md bez wywołania modelu i bez kredytów.
 * Stara wartość jest podmieniana w całym dokumencie (opisy komponentów,
 * powierzchnie, ściągawka kolorów), więc nic nie zostaje niespójne.
 */

export interface SpecEdits {
  colors?: { token: string; hex?: string; confirm?: boolean }[]
  families?: { token: string; name?: string; confirm?: boolean }[]
  radii?: { name: string; value: string }[]
}

export class SpecEditError extends Error {}

function replaceEverywhere(spec: DesignSpec, from: string, to: string): DesignSpec {
  if (!from || from === to) return spec
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const json = JSON.stringify(spec).replace(new RegExp(escaped, 'gi'), to)
  return JSON.parse(json)
}

export function applySpecEdits(
  input: DesignSpec,
  edits: SpecEdits
): { spec: DesignSpec; changes: number } {
  let spec: DesignSpec = structuredClone(input)
  let changes = 0

  for (const e of edits.colors ?? []) {
    const color = spec.colors.find((c) => c.token === e.token)
    if (!color) throw new SpecEditError(`Unknown color token ${e.token}`)
    if (e.hex !== undefined) {
      const hex = normalizeHex(e.hex)
      if (!hex) throw new SpecEditError(`Invalid color ${e.hex}`)
      if (hex !== color.hex) {
        const old = color.hex
        spec = replaceEverywhere(spec, old, hex)
        changes++
      }
    }
    const target = spec.colors.find((c) => c.token === e.token)!
    if ((e.hex !== undefined || e.confirm) && !target.confirmed) {
      target.confirmed = true
      target.assumed = false
      changes++
    }
  }

  for (const e of edits.families ?? []) {
    const family = spec.typography.families.find((f) => f.token === e.token)
    if (!family) throw new SpecEditError(`Unknown font token ${e.token}`)
    const name = e.name?.replace(/[^\p{L}\p{N} '\-]/gu, '').trim()
    if (e.name !== undefined && !name) throw new SpecEditError('Invalid font name')
    if (name && name !== family.name) {
      for (const row of spec.typography.scale) if (row.family === family.name) row.family = name
      family.name = name
      changes++
    }
    if ((name || e.confirm) && !family.confirmed) {
      family.confirmed = true
      family.assumed = false
      changes++
    }
  }

  for (const e of edits.radii ?? []) {
    const radius = spec.radii.find((r) => r.name === e.name)
    if (!radius) throw new SpecEditError(`Unknown radius ${e.name}`)
    const value = cssLength(e.value)
    if (!value) throw new SpecEditError(`Invalid radius ${e.value}`)
    if (value !== radius.value) {
      radius.value = value
      changes++
    }
  }

  // Potwierdzone wartości nie są już założeniami — znikają z listy do potwierdzenia.
  return { spec, changes }
}

export async function createEditedVersion(base: DesignDoc, edits: SpecEdits): Promise<DesignDoc> {
  if (base.status !== 'ready' || !base.spec) throw new SpecEditError('Version is not ready')
  const { spec, changes } = applySpecEdits(base.spec, edits)
  if (changes === 0) throw new SpecEditError('Nothing changed')

  const board = await Board.findOrFail(base.boardId)
  const ids = (base.sources ?? []).map((s) => s.assetId)
  const rows = new Map(
    (ids.length ? await Asset.query().whereIn('id', ids) : []).map((a) => [a.id, a])
  )
  const generatedAt = DateTime.utc()
  const preparedBy = await whiteLabelName(board.userId)

  // Numer wersji pod blokadą tablicy (DAT-2) — równoległa generacja albo druga
  // edycja nie dostaną tego samego numeru.
  return db.transaction(async (trx) => {
    await lockBoard(trx, board.id)
    const busy = await DesignDoc.query({ client: trx })
      .where('board_id', board.id)
      .whereIn('status', ['queued', 'running'])
      .first()
    if (busy) throw new SpecEditError('Generation in progress')
    const top = await DesignDoc.query({ client: trx })
      .where('board_id', board.id)
      .max('version as v')
    const version = Number(top[0].$extras.v ?? 0) + 1
    const { markdown, sources } = renderDesignMd(
      spec,
      (base.sources ?? []).map((s) => ({
        id: s.assetId,
        filename: s.filename,
        kind: s.kind,
        userNote: rows.get(s.assetId)?.userNote ?? null,
        usage: rows.get(s.assetId)?.usage,
      })),
      {
        boardTitle: board.title,
        version,
        generatedAt: generatedAt.toFormat("yyyy-MM-dd HH:mm 'UTC'"),
        preparedBy,
      }
    )

    return DesignDoc.create(
      {
        boardId: board.id,
        version,
        status: 'ready',
        contentMd: await withPlanFooter(markdown, board.userId),
        spec,
        sources,
        model: base.model,
        promptVersion: base.promptVersion,
        inputFingerprint: base.inputFingerprint,
        proMode: base.proMode,
        creditsCharged: 0,
        generatedAt,
        editedFromVersion: base.version,
      },
      { client: trx }
    )
  })
}
