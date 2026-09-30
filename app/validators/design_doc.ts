import vine from '@vinejs/vine'

/**
 * POST /api/boards/:id/design-doc — `force` wymusza generację mimo braku zmian,
 * `proMode` włącza Pro reasoning (płatne plany, ×2 kredyty).
 */
export const generateDesignDocValidator = vine.compile(
  vine.object({
    force: vine.boolean().optional(),
    proMode: vine.boolean().optional(),
  })
)

/** `?version=` w GET/download. */
export const designDocVersionValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
  })
)

/** GET /api/boards/:id/design-doc/estimate?pro=1 */
export const estimateValidator = vine.compile(
  vine.object({
    pro: vine.boolean().optional(),
  })
)

/** GET /api/boards/:id/design-doc/export?format=css|tailwind|tokens&version= */
export const exportValidator = vine.compile(
  vine.object({
    format: vine.enum(['css', 'tailwind', 'tokens']),
    version: vine.number().withoutDecimals().positive().optional(),
  })
)
