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

router.get('/', [controllers.Board, 'index']).as('home').use(middleware.auth())

router.get('/boards', [controllers.Board, 'index']).as('boards.index').use(middleware.auth())

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.get('/boards/create', [controllers.Board, 'create']).as('boards.create')
    router.post('/boards', [controllers.Board, 'store']).as('boards.store')
    router.get('/boards/:id', [controllers.Board, 'show']).as('boards.show')
    router.patch('/boards/:id', [controllers.Board, 'update']).as('boards.update')
    router.delete('/boards/:id', [controllers.Board, 'destroy']).as('boards.destroy')
    router.post('logout', [controllers.Session, 'destroy']).as('session.destroy')
  })
  .use(middleware.auth())

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
    router.get('/jobs/:id', [controllers.DesignDocs, 'job'])
  })
  .prefix('/api')
  .use(middleware.auth())

/**
 * Aliasy bez prefiksu `/api` — Bramka 2 sprawdza serwowanie pod
 * `/assets/:id/raw` i `/assets/:id/thumb`.
 */
router
  .group(() => {
    router.get('/assets/:id/raw', [controllers.Assets, 'raw']).as('assets.raw')
    router.get('/assets/:id/thumb', [controllers.Assets, 'thumb']).as('assets.thumb')
  })
  .use(middleware.auth())
