import app from '@adonisjs/core/services/app'
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
 */
const driveConfig = defineConfig({
  default: 'assets',
  services: {
    assets: services.fs({
      location: app.makePath('storage'),
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
