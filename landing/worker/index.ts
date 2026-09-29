/**
 * Worker przed statycznymi plikami canvai.dev:
 * - www.canvai.dev → canvai.dev (301),
 * - wejście na `/`: zapamiętany wybór języka (cookie `canvai_lang`) albo
 *   język przeglądarki — polski → /pl/, każdy inny → wersja angielska (`/`),
 * - nagłówki bezpieczeństwa na każdej odpowiedzi.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const LANG_COOKIE = 'canvai_lang'

function prefersPolish(header: string | null): boolean {
  if (!header) return false
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { base: tag.split('-')[0], q: q ? Number(q.split('=')[1]) || 0 : 1 }
    })
    .filter((x) => x.base === 'pl' || x.base === 'en')
    .sort((a, b) => b.q - a.q)
  return ranked[0]?.base === 'pl'
}

function withSecurityHeaders(response: Response): Response {
  const res = new Response(response.body, response)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  return res
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.hostname === 'www.canvai.dev') {
      url.hostname = 'canvai.dev'
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname === '/' && request.method === 'GET') {
      const cookie = request.headers.get('Cookie') ?? ''
      const chosen = cookie.match(new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(pl|en)`))?.[1]
      const lang = chosen ?? (prefersPolish(request.headers.get('Accept-Language')) ? 'pl' : 'en')
      if (lang === 'pl') {
        const res = Response.redirect(new URL(`/pl/${url.search}`, url).toString(), 302)
        const redirect = new Response(null, res)
        redirect.headers.set('Vary', 'Accept-Language, Cookie')
        redirect.headers.set('Cache-Control', 'private, no-store')
        return redirect
      }
    }

    const response = await env.ASSETS.fetch(request)
    return withSecurityHeaders(response)
  },
}
