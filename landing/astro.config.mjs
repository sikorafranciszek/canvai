// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

/**
 * canvai.dev — statyczna strona produktu. EN pod `/`, PL pod `/pl/`.
 * Wybór języka dla wejścia na `/` robi Worker (worker/index.ts): polska
 * przeglądarka → /pl/, zapamiętany wybór (cookie) ma pierwszeństwo.
 */
export default defineConfig({
  site: 'https://canvai.dev',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  i18n: {
    locales: ['en', 'pl'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'en', locales: { en: 'en-US', pl: 'pl-PL' } },
    }),
  ],
})
