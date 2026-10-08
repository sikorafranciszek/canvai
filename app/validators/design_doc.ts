import vine from '@vinejs/vine'
import { REVISABLE_SECTIONS } from '#services/ai/types'
import { EXPORT_FORMATS } from '#services/design/exports'

/**
 * POST /api/boards/:id/design-doc — `force` wymusza generację mimo braku zmian,
 * `proMode` włącza Pro reasoning (płatne plany, ×2 kredyty).
 */
export const generateDesignDocValidator = vine.compile(
  vine.object({
    force: vine.boolean().optional(),
    proMode: vine.boolean().optional(),
    /** Potwierdzenie nowej wersji ponad zaakceptowaną (FEAT-4). */
    overApproved: vine.boolean().optional(),
  })
)

/** `?version=` w GET/download. */
export const designDocVersionValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
  })
)

/** POST /api/boards/:id/design-doc/revise — poprawka poleceniem (FEAT-2). */
export const reviseValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive(),
    instruction: vine.string().trim().minLength(3).maxLength(500),
    section: vine.enum(REVISABLE_SECTIONS).optional(),
    overApproved: vine.boolean().optional(),
  })
)

/** POST /api/boards/:id/design-doc/approve — akceptacja wersji przez zespół (FEAT-4). */
export const approveValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive(),
  })
)

/** GET /api/boards/:id/design-doc/changes?version=&from= */
export const changesValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
    from: vine.number().withoutDecimals().positive().optional(),
  })
)

/** GET /api/boards/:id/design-doc/estimate?pro=1 */
export const estimateValidator = vine.compile(
  vine.object({
    pro: vine.boolean().optional(),
  })
)

/** POST /api/boards/:id/design-doc/edit — ręczna edycja tokenów (nowa wersja bez AI). */
export const editDesignDocValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive(),
    colors: vine
      .array(
        vine.object({
          token: vine.string().maxLength(80),
          hex: vine.string().maxLength(9).optional(),
          confirm: vine.boolean().optional(),
        })
      )
      .maxLength(40)
      .optional(),
    families: vine
      .array(
        vine.object({
          token: vine.string().maxLength(80),
          name: vine.string().trim().maxLength(60).optional(),
          confirm: vine.boolean().optional(),
        })
      )
      .maxLength(10)
      .optional(),
    radii: vine
      .array(vine.object({ name: vine.string().maxLength(80), value: vine.string().maxLength(40) }))
      .maxLength(20)
      .optional(),
  })
)

/** GET /api/boards/:id/design-doc/export?format=css|tailwind|tokens&version= */
export const exportValidator = vine.compile(
  vine.object({
    format: vine.enum(EXPORT_FORMATS),
    version: vine.number().withoutDecimals().positive().optional(),
  })
)
