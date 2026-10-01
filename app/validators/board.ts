import vine from '@vinejs/vine'

export const createBoardValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    template: vine.string().trim().maxLength(40).optional(),
  })
)

export const updateBoardValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
  })
)
