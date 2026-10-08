import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'
import { crm } from '#config/analytics'

/**
 * Hosty aplikacji (SEC-10). Na każdym innym hoście — domeny portali agencji,
 * dowolny nagłówek Host — działa tylko portal klienta i logo marki; reszta
 * przekierowuje na adres aplikacji (żadne /login pod cudzą marką).
 */
const appUrl = new URL(env.get('APP_URL'))
const APP_HOSTS = new Set([appUrl.hostname, crm.host, 'localhost', '127.0.0.1'])

const PORTAL_PATHS = [
  /^\/c\/[^/]+(\/(materials|feedback|print|preview))?\/?$/,
  /^\/brand\/\d+\/logo$/,
  /^\/health(\/deep)?$/,
  /^\/locale$/,
]

export function allowedOnHost(hostname: string, path: string): boolean {
  const host = hostname.toLowerCase()
  if (APP_HOSTS.has(host) || host.endsWith('.localhost')) return true
  return PORTAL_PATHS.some((re) => re.test(path))
}

export default class HostMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    const host = request.hostname() ?? ''
    if (!host || allowedOnHost(host, request.url())) return next()
    return response.redirect(`${appUrl.origin}${request.url(true)}`)
  }
}
