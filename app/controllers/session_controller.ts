import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { trackFor } from '#services/analytics/events'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', {})
  }

  async store(ctx: HttpContext) {
    const { request, auth, response } = ctx
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)

    await auth.use('web').login(user)
    trackFor(ctx, 'login', {}, { userId: user.id })
    response.redirect().toPath('/')
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    response.redirect().toPath('/login')
  }
}
