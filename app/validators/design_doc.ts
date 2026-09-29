import vine from '@vinejs/vine'

/** POST /api/boards/:id/design-doc — `force` wymusza generację mimo braku zmian. */
export const generateDesignDocValidator = vine.compile(
  vine.object({
    force: vine.boolean().optional(),
  })
)

/** `?version=` w GET/download. */
export const designDocVersionValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().positive().optional(),
  })
)
