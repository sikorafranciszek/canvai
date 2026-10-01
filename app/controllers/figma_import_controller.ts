import type { HttpContext } from '@adonisjs/core/http'
import encryption from '@adonisjs/core/services/encryption'
import logger from '@adonisjs/core/services/logger'
import vine from '@vinejs/vine'
import Asset from '#models/asset'
import Board from '#models/board'
import { entitlementsFor } from '#services/billing/plans'
import { serializeAsset, storeBuffer } from '#services/assets_service'
import { FigmaError, importFigma, parseFigmaUrl } from '#services/figma_import'
import { t } from '#services/i18n'
import { trackFor } from '#services/analytics/events'

const importValidator = vine.compile(
  vine.object({
    url: vine.string().trim().url({ require_protocol: true }).maxLength(2000),
    token: vine.string().trim().minLength(20).maxLength(200).optional(),
    remember: vine.boolean().optional(),
  })
)

const tokenValidator = vine.compile(
  vine.object({ token: vine.string().trim().minLength(20).maxLength(200) })
)

/**
 * Import z Figmy: ramki jako obrazy na tablicy + notatka z dokładnymi stylami
 * (kolory, typografia, promienie, cienie). Token osobisty Figmy — z zapytania
 * albo zapamiętany (zaszyfrowany) w koncie.
 */
export default class FigmaImportController {
  /** POST /api/boards/:id/import-figma */
  async store(ctx: HttpContext) {
    const { auth, params, request, response } = ctx
    const user = auth.user!
    const board = await Board.find(params.id)
    if (!board || board.userId !== user.id) return response.notFound()
    const input = await request.validateUsing(importValidator)
    if (!parseFigmaUrl(input.url)) {
      return response.status(422).json({ message: t('figma.badUrl'), code: 'E_FIGMA_URL' })
    }

    let token = input.token ?? null
    if (!token && user.figmaToken) {
      try {
        token = encryption.decrypt<string>(user.figmaToken)
      } catch {
        token = null
      }
    }
    if (!token) {
      return response.status(422).json({ message: t('figma.tokenRequired'), code: 'E_FIGMA_TOKEN' })
    }

    const { limits } = await entitlementsFor(user.id)
    const [{ $extras }] = await Asset.query().where('board_id', board.id).count('* as total')
    if (Number($extras.total) + 1 > limits.materialsPerBoard) {
      return response.status(402).json({
        message: t('billing.materialsLimit', { limit: limits.materialsPerBoard }),
        code: 'E_PLAN_LIMIT',
      })
    }

    let result
    try {
      result = await importFigma(input.url, token)
    } catch (error) {
      if (error instanceof FigmaError) {
        const key = {
          bad_url: 'figma.badUrl',
          auth: 'figma.auth',
          not_found: 'figma.notFound',
          rate_limited: 'figma.rateLimited',
          empty: 'figma.empty',
          failed: 'figma.failed',
        } as const
        return response.status(error.code === 'auth' ? 401 : 422).json({
          message: t(key[error.code]),
          code: `E_FIGMA_${error.code.toUpperCase()}`,
        })
      }
      logger.warn({ err: error }, 'figma import failed')
      return response.status(422).json({ message: t('figma.failed'), code: 'E_FIGMA_FAILED' })
    }

    if (input.token && input.remember !== false) {
      user.figmaToken = encryption.encrypt(input.token)
      await user.save()
    }

    // Tyle ramek, ile mieści limit planu.
    const room = Math.max(0, limits.materialsPerBoard - Number($extras.total))
    const assets: Asset[] = []
    for (const frame of result.frames.slice(0, room)) {
      const asset = await storeBuffer(
        board.id,
        {
          buffer: frame.buffer,
          mime: frame.mime,
          clientName: `${frame.name}.png`.slice(0, 200),
          size: frame.buffer.length,
        },
        'url'
      )
      if (!asset.userNote) {
        asset.userNote = t('figma.frameNote', { file: result.fileName, frame: frame.name }).slice(
          0,
          500
        )
        await asset.save()
      }
      assets.push(asset)
    }

    trackFor(
      ctx,
      'figma_imported',
      {
        frames: assets.length,
        colors: result.styles.colors.length,
        textStyles: result.styles.text.length,
      },
      { boardId: board.id }
    )
    return response.status(201).json({
      data: {
        assets: assets.map(serializeAsset),
        note: result.note,
        summary: {
          file: result.fileName,
          frames: assets.length,
          colors: result.styles.colors.length,
          fonts: [...new Set(result.styles.text.map((x) => x.family))],
        },
      },
    })
  }

  /** GET /api/figma — czy zapamiętano token. */
  async status({ auth, response }: HttpContext) {
    return response.json({ data: { connected: Boolean(auth.user!.figmaToken) } })
  }

  /** PUT /api/figma — zapamiętaj token. */
  async saveToken({ auth, request, response }: HttpContext) {
    const { token } = await request.validateUsing(tokenValidator)
    auth.user!.figmaToken = encryption.encrypt(token)
    await auth.user!.save()
    return response.json({ data: { connected: true } })
  }

  /** DELETE /api/figma — usuń zapamiętany token. */
  async deleteToken({ auth, response }: HttpContext) {
    auth.user!.figmaToken = null
    await auth.user!.save()
    return response.json({ data: { connected: false } })
  }
}
