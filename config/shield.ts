import { defineConfig } from '@adonisjs/shield'
import env from '#start/env'

const shieldConfig = defineConfig({
  /**
   * Configure CSP policies for your app. Refer documentation
   * to learn more.
   */
  csp: {
    /**
     * Content-Security-Policy w produkcji (obrona w głąb przed XSS). W dev Vite
     * wstrzykuje skrypty inline (HMR, React Refresh), więc tam jest wyłączona.
     * Odpowiedzi plików i podglądu UI ustawiają własne, ostrzejsze CSP.
     */
    enabled: env.get('NODE_ENV') === 'production',

    /**
     * Per-resource CSP directives.
     */
    directives: {
      defaultSrc: [`'self'`],
      // Skrypty tylko z własnej domeny (bundle Vite) + Microsoft Clarity po zgodzie.
      scriptSrc: [`'self'`, 'https://www.clarity.ms', 'https://*.clarity.ms'],
      // React i biblioteki UI ustawiają style inline.
      styleSrc: [`'self'`, `'unsafe-inline'`],
      imgSrc: [`'self'`, 'data:', 'blob:', 'https:'],
      fontSrc: [`'self'`, 'data:'],
      connectSrc: [`'self'`, 'https://*.clarity.ms'],
      frameSrc: [`'self'`],
      frameAncestors: [`'self'`],
      objectSrc: [`'none'`],
      baseUri: [`'self'`],
      formAction: [`'self'`],
    },

    /**
     * Report violations without blocking resources.
     */
    reportOnly: false,
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more.
   */
  csrf: {
    /**
     * Enable CSRF token verification for state-changing requests.
     */
    enabled: env.get('NODE_ENV') !== 'test',

    /**
     * Route patterns to exclude from CSRF checks.
     * Useful for external webhooks or API endpoints.
     */
    // Webhooki (podpis HMAC) oraz API v1 / MCP (token Bearer, bez sesji).
    exceptRoutes: (ctx) => {
      const url = ctx.request.url()
      // Wypis one-click (RFC 8058): POST od klienta poczty, autoryzuje podpisany token.
      return (
        url === '/webhooks/polar' ||
        url === '/mcp' ||
        url.startsWith('/api/v1/') ||
        (ctx.request.method() === 'POST' && url.startsWith('/unsubscribe/'))
      )
    },

    /**
     * Expose an encrypted XSRF-TOKEN cookie for frontend HTTP clients.
     */
    enableXsrfCookie: true,

    /**
     * HTTP methods protected by CSRF validation.
     */
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iframes.
   */
  xFrame: {
    /**
     * Enable the X-Frame-Options header.
     */
    enabled: true,

    /**
     * Block all framing attempts. Default value is DENY.
     */
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS.
   */
  hsts: {
    /**
     * Enable the Strict-Transport-Security header.
     */
    enabled: true,

    /**
     * HSTS policy duration remembered by browsers.
     */
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing content types and rely only
   * on the response content-type header.
   */
  contentTypeSniffing: {
    /**
     * Enable X-Content-Type-Options: nosniff.
     */
    enabled: true,
  },
})

export default shieldConfig
