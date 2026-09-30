import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import vine from '@vinejs/vine'
import Asset from '#models/asset'
import Board from '#models/board'
import { entitlementsFor } from '#services/billing/plans'
import { serializeAsset, storeBuffer, storeLink } from '#services/assets_service'
import { safeFetch } from '#services/safe_fetch'
import { analyzeSite, siteStyleNote } from '#services/site_import'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const importValidator = vine.compile(
  vine.object({
    url: vine.string().trim().url({ require_protocol: true }).maxLength(2000),
  })
)

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * POST /api/boards/:id/import-site — styl strony z adresu URL: karta linku,
 * obraz og:image (jeśli jest) i notatka ze stylem dla AI. Bez przeglądarki —
 * analiza HTML i CSS. Klient umieszcza wynik na płótnie.
 */
export default class SiteImportController {
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) return response.notFound()
    const { url } = await request.validateUsing(importValidator)

    const { limits } = await entitlementsFor(auth.user!.id)
    const [{ $extras }] = await Asset.query().where('board_id', board.id).count('* as total')
    if (Number($extras.total) + 2 > limits.materialsPerBoard) {
      return response.status(402).json({
        message: t('billing.materialsLimit', { limit: limits.materialsPerBoard }),
        code: 'E_PLAN_LIMIT',
      })
    }

    let style
    try {
      style = await analyzeSite(url)
    } catch (error) {
      logger.info({ err: error, url }, 'site import failed')
      return response.status(422).json({ message: t('siteImport.failed'), code: 'E_SITE_IMPORT' })
    }

    const assets: Asset[] = [await storeLink(board.id, style.url)]
    if (style.ogImage) {
      try {
        const img = await safeFetch(style.ogImage, { timeoutMs: 6000, maxBytes: 8 * 1024 * 1024 })
        const mime = img.contentType.split(';')[0].trim().toLowerCase()
        if (
          img.status >= 200 &&
          img.status < 300 &&
          IMAGE_TYPES.includes(mime) &&
          img.body.length > 0
        ) {
          assets.push(
            await storeBuffer(
              board.id,
              {
                buffer: img.body,
                mime,
                clientName: `${style.host}-preview`,
                size: img.body.length,
              },
              'url'
            )
          )
        }
      } catch {
        // Obraz podglądu jest dodatkiem — import działa bez niego.
      }
    }

    const note = siteStyleNote(style)
    for (const asset of assets) {
      if (!asset.userNote) {
        asset.userNote =
          asset.kind === 'link'
            ? t('siteImport.linkNote')
            : t('siteImport.imageNote', { host: style.host })
        await asset.save()
      }
    }

    trackFor(
      ctx,
      'site_imported',
      { host: style.host, colors: style.colors.length, fonts: style.fonts.length, image: assets.length > 1 },
      { boardId: board.id }
    )
    return response.status(201).json({
      data: {
        assets: assets.map(serializeAsset),
        note,
        summary: { host: style.host, colors: style.colors.length, fonts: style.fonts },
      },
    })
  }
}
