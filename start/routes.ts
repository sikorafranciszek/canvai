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

/** Webhooki Lemon Squeezy (podpis HMAC zamiast sesji i CSRF). */
router.post('/webhooks/lemonsqueezy', [controllers.Webhooks, 'lemonsqueezy'])

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

    // Ustawienia konta
    router.get('/settings', [controllers.Settings, 'show']).as('settings.show')
    router
      .patch('/settings/profile', [controllers.Settings, 'updateProfile'])
      .as('settings.profile')
    router
      .put('/settings/password', [controllers.Settings, 'updatePassword'])
      .as('settings.password')

    // Rozliczenia
    router.get('/billing', [controllers.Billing, 'show']).as('billing.show')
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
