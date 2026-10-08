import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { t } from '#services/i18n'
import Board from '#models/board'
import Asset from '#models/asset'

/**
 * Trasy dostępne przed potwierdzeniem e-maila — tylko odczyt WŁASNEJ tablicy
 * przykładowej (UX-5): nowy użytkownik od razu widzi, czym jest DESIGN.md.
 */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    /** Niepotwierdzony e-mail: tylko podgląd własnej tablicy przykładowej (UX-5). */
    sampleOnly?: boolean
  }
}

const SAMPLE_BOARD_ROUTES = new Set([
  '/boards/:id',
  '/api/boards/:id/scene',
  '/api/boards/:id/assets',
  '/api/boards/:id/design-doc',
  '/api/boards/:id/design-docs',
  '/api/boards/:id/events',
  '/api/boards/:id/comments',
  '/api/boards/:id/members',
])
const SAMPLE_ASSET_ROUTES = new Set([
  '/api/assets/:id/raw',
  '/api/assets/:id/thumb',
  '/api/assets/:id/content',
  '/assets/:id/raw',
  '/assets/:id/thumb',
])

async function isOwnSampleRead(ctx: HttpContext, userId: number): Promise<boolean> {
  if (ctx.request.method() !== 'GET') return false
  const pattern = ctx.route?.pattern ?? ''
  const id = Number(ctx.params.id)
  if (!Number.isInteger(id) || id <= 0) return false
  let boardId: number | null = null
  if (SAMPLE_BOARD_ROUTES.has(pattern)) boardId = id
  else if (SAMPLE_ASSET_ROUTES.has(pattern)) boardId = (await Asset.find(id))?.boardId ?? null
  if (!boardId) return false
  const board = await Board.find(boardId)
  return Boolean(board?.isSample && board.userId === userId)
}

/**
 * Wymaga potwierdzonego adresu e-mail. Strony → przekierowanie na ekran
 * weryfikacji; API → 403 JSON (klient pokaże komunikat). Stosować po `auth`.
 */
export default class VerifiedMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    // Konto zablokowane w CRM — wylogowanie i koniec dostępu.
    if (user?.disabledAt) {
      await ctx.auth.use('web').logout()
      if (ctx.request.url().startsWith('/api/')) {
        return ctx.response
          .status(403)
          .json({ message: t('account.disabled'), code: 'E_ACCOUNT_DISABLED' })
      }
      ctx.session.flash('error', t('account.disabled'))
      return ctx.response.redirect().toPath('/login')
    }
    if (user && !user.emailVerifiedAt) {
      if (await isOwnSampleRead(ctx, user.id)) {
        // Podgląd przykładu: rola „viewer” (bez edycji) i baner z prośbą o potwierdzenie.
        ctx.sampleOnly = true
        return next()
      }
      if (ctx.request.url().startsWith('/api/')) {
        return ctx.response
          .status(403)
          .json({ message: t('account.emailNotVerified'), code: 'E_EMAIL_NOT_VERIFIED' })
      }
      return ctx.response.redirect().toPath('/verify-email')
    }
    return next()
  }
}
