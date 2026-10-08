import vine from '@vinejs/vine'
import { assetSources } from '#config/assets'
import { ASSET_ASPECTS, ASSET_ROLES } from '#shared/asset-usage'

/**
 * Walidator pól formularza uploadu (multipart). Pliki są obsługiwane
 * osobno przez `request.files('files')` w kontrolerze — vine nie dotyka
 * strumieni plików.
 */
export const uploadAssetsValidator = vine.compile(
  vine.object({
    source: vine.enum(assetSources).optional(),
    url: vine
      .string()
      .url({ protocols: ['http', 'https'], require_protocol: true })
      .optional(),
    note: vine.string().trim().maxLength(2000).optional(),
  })
)

/** Walidator PATCH /api/assets/:id (notatka użytkownika i sposób użycia w DESIGN.md). */
export const updateAssetValidator = vine.compile(
  vine.object({
    note: vine.string().trim().maxLength(2000).optional(),
    usage: vine
      .object({
        role: vine.enum(ASSET_ROLES).nullable(),
        aspects: vine.array(vine.enum(ASSET_ASPECTS)).maxLength(ASSET_ASPECTS.length),
      })
      .optional(),
  })
)

/** POST /api/assets/:id/crop — kadr w ułamkach obrazu (FEAT-3). */
const fraction = () => vine.number().min(0).max(1)
export const cropAssetValidator = vine.compile(
  vine.object({
    x: fraction(),
    y: fraction(),
    width: fraction(),
    height: fraction(),
  })
)
