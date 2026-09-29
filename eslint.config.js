import { configApp } from '@adonisjs/eslint-config'
import { react } from '@adonisjs/eslint-config/react'

// `landing/` to osobny projekt (Astro, strona canvai.dev) z własnym toolingiem.
export default configApp({ ignores: ['landing/**'] }, ...react)
