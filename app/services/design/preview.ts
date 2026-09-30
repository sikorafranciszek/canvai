import { DateTime } from 'luxon'
import Board from '#models/board'
import DesignDoc from '#models/design_doc'
import type DesignPreview from '#models/design_preview'
import { getProvider } from '#services/ai/provider'
import { chargedFor } from '#services/billing/credits'
import { sanitizePreviewHtml } from '#services/design/preview_template'
import { AiProviderError } from '#services/ai/types'
import { t } from '#services/i18n'

/**
 * Podgląd UI: model buduje przykładową stronę HTML z gotowej wersji DESIGN.md.
 * Wynik jest oczyszczany (bez skryptów i zewnętrznych zasobów poza fontami)
 * i serwowany w piaskownicy z restrykcyjnym CSP.
 */
export async function runPreview(preview: DesignPreview): Promise<DesignPreview> {
  const doc = await DesignDoc.findOrFail(preview.designDocId)
  if (doc.status !== 'ready' || !doc.contentMd) {
    throw new AiProviderError(t('preview.needsReady'), false)
  }
  if (!doc.spec) throw new AiProviderError(t('preview.needsSpec'), false)
  const board = await Board.findOrFail(doc.boardId)
  const provider = getProvider()

  preview.status = 'running'
  preview.error = null
  await preview.save()

  const result = await provider.composePreview({
    boardTitle: board.title,
    designMd: doc.contentMd,
    spec: doc.spec,
  })

  preview.status = 'ready'
  preview.html = sanitizePreviewHtml(result.data.html)
  preview.model = result.model
  preview.generatedAt = DateTime.utc()
  preview.creditsCharged = await chargedFor({ designPreviewId: preview.id })
  await preview.save()
  return preview
}
