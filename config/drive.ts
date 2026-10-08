import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig, services } from '@adonisjs/drive'

/**
 * Konfiguracja @adonisjs/drive (Flydrive).
 *
 * Dysk `assets` jest PRYWATNY — pliki NIE są serwowane przez auto-route Drive.
 * Serwowanie realizuje AssetsController (`GET /assets/:id/raw|thumb`) po
 * sprawdzeniu dostępu do tablicy. Klucze: `boards/{boardId}/assets/{ulid}.{ext}`.
 *
 * - `STORAGE_DRIVER=fs` (domyślnie): katalog `STORAGE_PATH` na wolumenie.
 * - `STORAGE_DRIVER=s3` (ARC-4): S3 albo Cloudflare R2 — pliki wspólne dla
 *   wielu instancji. Kontrolery operują wyłącznie na kluczu, więc nic się nie
 *   zmienia; kopia zapasowa obejmuje wtedy samą bazę (pliki chroni wersjonowanie
 *   bucketa).
 *
 * Testy piszą do osobnego `tmp/test-storage/` — czyszczą go przed każdym
 * testem, więc nie mogą dotykać uploadów z `storage/` środowiska dev.
 */
export const storageDriver = (): 'fs' | 's3' =>
  !app.inTest && env.get('STORAGE_DRIVER', 'fs') === 's3' ? 's3' : 'fs'

const driveConfig = defineConfig({
  default: 'assets',
  services: {
    assets:
      storageDriver() === 's3'
        ? services.s3({
            credentials: {
              accessKeyId: env.get('STORAGE_S3_ACCESS_KEY_ID', ''),
              secretAccessKey: env.get('STORAGE_S3_SECRET_ACCESS_KEY', ''),
            },
            region: env.get('STORAGE_S3_REGION', 'auto'),
            endpoint: env.get('STORAGE_S3_ENDPOINT'),
            bucket: env.get('STORAGE_S3_BUCKET', ''),
            visibility: 'private',
            // R2 nie obsługuje ACL; widoczność i tak jest prywatna.
            supportsACL: false,
            forcePathStyle: true,
          })
        : services.fs({
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
    assets: () => import('flydrive/drivers/fs').FSDriver | import('flydrive/drivers/s3').S3Driver
  }
}
