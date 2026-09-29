import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig, services } from '@adonisjs/drive'

/**
 * Konfiguracja @adonisjs/drive (Flydrive).
 *
 * Dysk lokalny `assets` zapisuje do `storage/` i jest domyślnie PRYWATNY —
 * pliki NIE są serwowane przez auto-route Drive (serveFiles: false). Serwowanie
 * realizuje AssetsController przez `GET /assets/:id/raw|thumb` po sprawdzeniu
 * właściciela tablicy. Klucze mają postać `boards/{boardId}/assets/{ulid}.{ext}`.
 *
 * Podmiana na S3 = dopisanie drugiego serwisu i zmiana `default` — kontrolery
 * nie muszą się zmieniać (operują wyłącznie na kluczu).
 *
 * Testy piszą do osobnego `tmp/test-storage/` — czyszczą go przed każdym
 * testem, więc nie mogą dotykać uploadów z `storage/` środowiska dev.
 */
const driveConfig = defineConfig({
  default: 'assets',
  services: {
    assets: services.fs({
      location: app.inTest
        ? app.tmpPath('test-storage')
        : env.get('STORAGE_PATH', app.makePath('storage')),
      visibility: 'private',
    }),
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  interface DriveDisks {
    assets: () => import('flydrive/drivers/fs').FSDriver
  }
}
