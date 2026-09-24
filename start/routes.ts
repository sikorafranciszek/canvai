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
