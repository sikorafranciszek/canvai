import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import drive from '@adonisjs/drive/services/main'
import Board from '#models/board'
import Asset from '#models/asset'
import { updateAssetValidator, uploadAssetsValidator } from '#validators/asset'
import {
  pruneOrphanAssets,
  deleteAssetFiles,
  serializeAsset,
  storeLink,
  storeUploadedFile,
} from '#services/assets_service'
import { t } from '#services/i18n'
import { entitlementsFor } from '#services/billing/plans'

/** Czyści nazwę pliku pod nagłówek Content-Disposition. */
function safeAttachmentName(name: string | null | undefined, fallback: string): string {
  return (name ?? fallback).replace(/["\\\r\n]/g, '_')
}

export default class AssetsController {
  /** Zwraca asset widoczny tylko dla właściciela tablicy, inaczej null. */
  private async findOwned(userId: number, assetId: string | number) {
    const asset = await Asset.query().where('id', assetId).preload('board').first()
    if (!asset || asset.board.userId !== userId) return null
    return asset
  }

  /** Lista assetów tablicy (dla właściciela). */
  async index({ auth, params, response }: HttpContext) {
    const user = auth.user!
    const board = await Board.find(params.id)
    if (!board || board.userId !== user.id) return response.notFound()

    const assets = await Asset.query().where('board_id', board.id).orderBy('created_at', 'asc')
    return response.json({ data: assets.map(serializeAsset) })
  }

  /**
   * POST /api/boards/:id/assets — multipart, wiele plików naraz.
   * source: paste|drop|upload|url. Dla `url` tworzy kartę linku.
   */
  async store({ auth, request, response, params }: HttpContext) {
    const user = auth.user!
    const board = await Board.find(params.id)
    if (!board || board.userId !== user.id) return response.notFound()

    const payload = await request.validateUsing(uploadAssetsValidator)
    const source = payload.source ?? 'upload'

    // Limit materiałów planu (liczone razem z tym, co właśnie przychodzi).
    const { limits } = await entitlementsFor(user.id)
    if (Number.isFinite(limits.materialsPerBoard)) {
      const [{ $extras }] = await Asset.query().where('board_id', board.id).count('* as total')
      const incoming = source === 'url' ? 1 : request.files('files').length
      if (Number($extras.total) + incoming > limits.materialsPerBoard) {
        throw new Exception(t('billing.materialsLimit', { limit: limits.materialsPerBoard }), {
          status: 402,
          code: 'E_PLAN_LIMIT',
        })
      }
    }

    if (source === 'url') {
      if (!payload.url) {
        throw new Exception(t('asset.urlRequired'), {
          status: 422,
          code: 'E_ASSET_URL_REQUIRED',
        })
      }
      const asset = await storeLink(board.id, payload.url)
      if (payload.note) {
        asset.userNote = payload.note
        await asset.save()
      }
      return response.status(201).json({ data: [serializeAsset(asset)] })
    }

    const files = request.files('files')
    if (files.length === 0) {
      throw new Exception(t('asset.noFiles'), { status: 422, code: 'E_ASSET_NO_FILES' })
    }

    const assets = await Promise.all(files.map((file) => storeUploadedFile(board.id, file, source)))
    return response.status(201).json({ data: assets.map(serializeAsset) })
  }

  /** PATCH /api/assets/:id — notatka użytkownika. */
  async update({ auth, params, request, response }: HttpContext) {
    const asset = await this.findOwned(auth.user!.id, params.id)
    if (!asset) return response.notFound()

    const { note } = await request.validateUsing(updateAssetValidator)
    asset.userNote = note ?? null
    await asset.save()

    return response.json({ data: serializeAsset(asset) })
  }

  /** DELETE /api/assets/:id — usuwa wiersz oraz pliki na dysku. */
  async destroy({ auth, params, response }: HttpContext) {
    const asset = await this.findOwned(auth.user!.id, params.id)
    if (!asset) return response.notFound()

    await deleteAssetFiles(asset)
    await asset.delete()

    return response.status(204)
  }

  /** GET /assets/:id/raw — oryginał (SVG: attachment + CSP, bez inline). */
  async raw({ auth, params, response }: HttpContext) {
    const asset = await this.findOwned(auth.user!.id, params.id)
    if (!asset || !asset.storageKey) return response.notFound()

    const stream = await drive.use().getStream(asset.storageKey)
    response.header('Content-Type', asset.mime ?? 'application/octet-stream')
    if (asset.size != null) response.header('Content-Length', String(asset.size))
    response.header('Cache-Control', 'private, max-age=31536000, immutable')

    if (asset.mime === 'image/svg+xml') {
      // SVG nigdy nie jest serwowany inline — attachment + CSP niweluje XSS.
      response.header(
        'Content-Disposition',
        `attachment; filename="${safeAttachmentName(asset.filename, 'asset.svg')}"`
      )
      response.header('Content-Security-Policy', "default-src 'none'; sandbox")
    }

    response.stream(stream)
  }

  /** GET /assets/:id/thumb — miniatura webp (max 512px). */
  async thumb({ auth, params, response }: HttpContext) {
    const asset = await this.findOwned(auth.user!.id, params.id)
    if (!asset || !asset.thumbKey) return response.notFound()

    const stream = await drive.use().getStream(asset.thumbKey)
    response.header('Content-Type', 'image/webp')
    response.header('Cache-Control', 'private, max-age=31536000, immutable')
    response.stream(stream)
  }

  /**
   * GET /assets/:id/content — wariant do osadzenia w <img>/canvas.
   * SVG → miniatura (webp, bezpieczna inline); obrazy rastrowe → oryginał;
   * pdf/plik → oryginał jako attachment; link → 404.
   */
  async content({ auth, params, response }: HttpContext) {
    const asset = await this.findOwned(auth.user!.id, params.id)
    if (!asset) return response.notFound()

    if (asset.kind === 'link') return response.notFound()

    if (asset.kind === 'image' && asset.mime === 'image/svg+xml' && asset.thumbKey) {
      const stream = await drive.use().getStream(asset.thumbKey)
      response.header('Content-Type', 'image/webp')
      response.header('Cache-Control', 'private, max-age=31536000, immutable')
      response.stream(stream)
      return
    }

    if (!asset.storageKey) return response.notFound()

    const stream = await drive.use().getStream(asset.storageKey)
    response.header('Content-Type', asset.mime ?? 'application/octet-stream')
    if (asset.size != null) response.header('Content-Length', String(asset.size))
    response.header('Cache-Control', 'private, max-age=31536000, immutable')

    if (asset.kind !== 'image') {
      response.header(
        'Content-Disposition',
        `attachment; filename="${safeAttachmentName(asset.filename, 'asset')}"`
      )
    }

    response.stream(stream)
  }

  /** POST /api/boards/:id/assets/prune — usuwa assety, których nie ma na płótnie. */
  async prune({ auth, params, response }: HttpContext) {
    const board = await Board.find(params.id)
    if (!board || board.userId !== auth.user!.id) return response.notFound()
    const removed = await pruneOrphanAssets(board.id)
    return response.json({ data: { removed } })
  }
}
