/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import { crm } from '#config/analytics'

/** Healthcheck dla Coolify / load balancera: proces żyje i baza odpowiada. */
router.get('/health', async ({ response }) => {
  const { default: db } = await import('@adonisjs/lucid/services/db')
  await db.rawQuery('select 1')
  return response.json({ status: 'ok' })
})

router
  .get('/', [controllers.Board, 'index'])
  .as('home')
  .use([middleware.auth(), middleware.verified()])

router
  .get('/boards', [controllers.Board, 'index'])
  .as('boards.index')
  .use([middleware.auth(), middleware.verified()])

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])

    // Reset hasła
    router.get('forgot-password', [controllers.PasswordReset, 'create']).as('password.forgot')
    router.post('forgot-password', [controllers.PasswordReset, 'store']).as('password.email')
    router.get('reset-password/:token', [controllers.PasswordReset, 'edit']).as('password.reset')
    router.post('reset-password', [controllers.PasswordReset, 'update']).as('password.update')
  })
  .use(middleware.guest())

/**
 * Weryfikacja e-mail. Ekran „sprawdź skrzynkę” i ponowna wysyłka wymagają
 * zalogowania (ale NIE weryfikacji); link z maila działa bez zalogowania.
 */
router
  .group(() => {
    router.get('/verify-email', [controllers.EmailVerification, 'notice']).as('verification.notice')
    router
      .post('/verify-email/resend', [controllers.EmailVerification, 'resend'])
      .as('verification.resend')
    router.post('logout', [controllers.Session, 'destroy']).as('session.destroy')
  })
  .use(middleware.auth())
router
  .get('/verify-email/:token', [controllers.EmailVerification, 'verify'])
  .as('verification.verify')

/**
 * API v1 i serwer MCP — token Bearer (`cvai_…`), bez sesji i CSRF.
 * Dla Cursora / Claude Code / skryptów: odczyt tablic, DESIGN.md i tokenów.
 */
router.post('/mcp', [controllers.Mcp, 'handle']).use(middleware.apiToken())
router.get('/mcp', [controllers.Mcp, 'notAllowed']).as('mcp.get')
router.delete('/mcp', [controllers.Mcp, 'notAllowed']).as('mcp.delete')
router
  .group(() => {
    router.get('/boards', [controllers.ApiV1, 'boards'])
    router.get('/boards/:id/design-md', [controllers.ApiV1, 'designMd'])
    router.get('/boards/:id/tokens', [controllers.ApiV1, 'tokens'])
  })
  .prefix('/api/v1')
  .use(middleware.apiToken())

/** Portal klienta — publiczny link tablicy (bez konta). */
router.get('/c/:token', [controllers.Portal, 'show']).as('portal.show')
router.post('/c/:token/materials', [controllers.Portal, 'materials']).as('portal.materials')
router.post('/c/:token/feedback', [controllers.Portal, 'feedback']).as('portal.feedback')
router.get('/c/:token/print', [controllers.Portal, 'print']).as('portal.print')

/** Webhooki Polar.sh (podpis Standard Webhooks zamiast sesji i CSRF). */
router.post('/webhooks/polar', [controllers.Webhooks, 'polar'])

/** Wybór języka (cookie + konto zalogowanego). */
router.post('/locale', [controllers.Locale, 'update']).as('locale.update')

/** Podgląd lokalnej skrzynki (transport `outbox`) — kontroler zwraca 404 w produkcji. */
router.get('/dev/mailbox', [controllers.DevMailbox, 'index'])

router
  .group(() => {
    router.get('/boards/create', [controllers.Board, 'create']).as('boards.create')
    router.post('/boards', [controllers.Board, 'store']).as('boards.store')
    router.get('/boards/:id', [controllers.Board, 'show']).as('boards.show')
    router.patch('/boards/:id', [controllers.Board, 'update']).as('boards.update')
    router.delete('/boards/:id', [controllers.Board, 'destroy']).as('boards.destroy')
    router.get('/boards/:id/previews/:previewId', [controllers.DesignPreviews, 'html'])
    router.get('/boards/:id/design-doc/print', [controllers.DesignDocs, 'print'])

    // Ustawienia konta
    router.get('/settings', [controllers.Settings, 'show']).as('settings.show')
    router
      .patch('/settings/profile', [controllers.Settings, 'updateProfile'])
      .as('settings.profile')
    router
      .put('/settings/password', [controllers.Settings, 'updatePassword'])
      .as('settings.password')
    router.post('/settings/api-tokens', [controllers.ApiTokens, 'store']).as('apiTokens.store')
    router
      .delete('/settings/api-tokens/:id', [controllers.ApiTokens, 'destroy'])
      .as('apiTokens.destroy')

    // Rozliczenia
    router.get('/billing', [controllers.Billing, 'show']).as('billing.show')
    router.get('/brand-kits', [controllers.BrandKits, 'page']).as('brandKits.page')
    router.post('/billing/checkout', [controllers.Billing, 'checkout']).as('billing.checkout')
    router.get('/billing/portal', [controllers.Billing, 'portal']).as('billing.portal')
  })
  .use([middleware.auth(), middleware.verified()])

/**
 * API assetów i sceny (M2b). Wszystko pod autoryzacją właściciela tablicy.
 */
router
  .group(() => {
    // Scena
    router.get('/boards/:id/scene', [controllers.Scenes, 'show'])
    router.put('/boards/:id/scene', [controllers.Scenes, 'update'])

    // Asset
    router.get('/boards/:id/assets', [controllers.Assets, 'index'])
    router.post('/boards/:id/assets', [controllers.Assets, 'store'])
    router.post('/boards/:id/assets/prune', [controllers.Assets, 'prune'])
    router.post('/boards/:id/import-site', [controllers.SiteImport, 'store'])
    router.post('/boards/:id/import-figma', [controllers.FigmaImport, 'store'])
    router.get('/figma', [controllers.FigmaImport, 'status'])
    router.put('/figma', [controllers.FigmaImport, 'saveToken'])
    router.delete('/figma', [controllers.FigmaImport, 'deleteToken'])
    router.patch('/assets/:id', [controllers.Assets, 'update'])
    router.delete('/assets/:id', [controllers.Assets, 'destroy'])
    router.get('/assets/:id/raw', [controllers.Assets, 'raw']).as('api.assets.raw')
    router.get('/assets/:id/thumb', [controllers.Assets, 'thumb']).as('api.assets.thumb')
    router.get('/assets/:id/content', [controllers.Assets, 'content']).as('api.assets.content')

    // DESIGN.md (M3)
    router.post('/boards/:id/design-doc', [controllers.DesignDocs, 'store'])
    router.get('/boards/:id/design-doc', [controllers.DesignDocs, 'show'])
    router.get('/boards/:id/design-doc/download', [controllers.DesignDocs, 'download'])
    router.get('/boards/:id/design-docs', [controllers.DesignDocs, 'index'])
    router.get('/boards/:id/design-doc/estimate', [controllers.DesignDocs, 'estimate'])
    router.get('/boards/:id/design-doc/export', [controllers.DesignDocs, 'export'])
    router.post('/boards/:id/design-doc/edit', [controllers.DesignDocs, 'edit'])
    router.get('/boards/:id/design-doc/preview', [controllers.DesignPreviews, 'show'])
    router.get('/boards/:id/share', [controllers.BoardShares, 'show'])
    router.put('/boards/:id/share', [controllers.BoardShares, 'update'])
    router.post('/boards/:id/share/rotate', [controllers.BoardShares, 'rotate'])
    router.post('/assets/:id/accept', [controllers.BoardShares, 'accept'])
    router.get('/brand-kits', [controllers.BrandKits, 'index'])
    router.post('/brand-kits', [controllers.BrandKits, 'store'])
    router.patch('/brand-kits/:id', [controllers.BrandKits, 'update'])
    router.delete('/brand-kits/:id', [controllers.BrandKits, 'destroy'])
    router.post('/boards/:id/design-doc/preview', [controllers.DesignPreviews, 'store'])

    // Rozliczenia
    router.get('/billing', [controllers.Billing, 'summary'])
    router.get('/jobs/:id', [controllers.DesignDocs, 'job'])
  })
  .prefix('/api')
  .use([middleware.auth(), middleware.verified()])

/**
 * Aliasy bez prefiksu `/api` — Bramka 2 sprawdza serwowanie pod
 * `/assets/:id/raw` i `/assets/:id/thumb`.
 */
router
  .group(() => {
    router.get('/assets/:id/raw', [controllers.Assets, 'raw']).as('assets.raw')
    router.get('/assets/:id/thumb', [controllers.Assets, 'thumb']).as('assets.thumb')
  })
  .use([middleware.auth(), middleware.verified()])

/**
 * Panel CRM — tylko pod domeną CRM (crm.canvai.dev; w dev crm.localhost).
 * Trasy domenowe mają pierwszeństwo: pod tym hostem aplikacja nie jest dostępna.
 */
router
  .group(() => {
    router
      .group(() => {
        router.get('/login', [controllers.Crm, 'loginPage']).as('crm.login')
        router.post('/login', [controllers.Crm, 'login']).as('crm.login.store')
      })
      .use(middleware.crmAdmin({ guest: true }))

    router
      .group(() => {
        router.get('/', [controllers.Crm, 'dashboard']).as('crm.dashboard')
        router.post('/logout', [controllers.Crm, 'logout']).as('crm.logout')
        router.get('/users', [controllers.Crm, 'users']).as('crm.users')
        router.get('/users/:id', [controllers.Crm, 'user']).as('crm.user')
        router.post('/users/:id/credits', [controllers.Crm, 'grantCredits']).as('crm.user.credits')
        router.post('/users/:id/verify', [controllers.Crm, 'verifyEmail']).as('crm.user.verify')
        router.post('/users/:id/disable', [controllers.Crm, 'setDisabled']).as('crm.user.disable')
        router.post('/users/:id/enable', [controllers.Crm, 'setDisabled']).as('crm.user.enable')
        router
          .post('/users/:id/password-reset', [controllers.Crm, 'sendReset'])
          .as('crm.user.reset')
        router.post('/users/:id/notes', [controllers.Crm, 'addNote']).as('crm.user.notes')
        router
          .delete('/users/:id/notes/:noteId', [controllers.Crm, 'deleteNote'])
          .as('crm.user.notes.destroy')
        router.put('/users/:id/tags', [controllers.Crm, 'setTags']).as('crm.user.tags')
        router.delete('/users/:id', [controllers.Crm, 'destroy']).as('crm.user.destroy')
        router.get('/analytics', [controllers.Crm, 'analytics']).as('crm.analytics')
        router.get('/logs', [controllers.Crm, 'logs']).as('crm.logs')
        router.post('/backup', [controllers.Crm, 'backupNow']).as('crm.backup')
      })
      .use(middleware.crmAdmin())
  })
  .domain(crm.host)
