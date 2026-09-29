import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

/**
 * Bezwzględny URL do linków w mailach. W produkcji WYŁĄCZNIE z `APP_URL`
 * (nagłówek Host od klienta nie może decydować, dokąd prowadzi link resetu);
 * lokalnie z adresu żądania, żeby link działał na dowolnym porcie dev.
 */
export function absoluteUrl(ctx: HttpContext, path: string): string {
  const base = app.inProduction
    ? env.get('APP_URL')
    : `${ctx.request.protocol()}://${ctx.request.host()}`
  return `${String(base).replace(/\/$/, '')}${path}`
}
