import { test } from '@japa/runner'
import { productionConfigProblems } from '#start/production_checks'

test.group('Konfiguracja produkcji (REL-3)', () => {
  const env = (values: Record<string, string>) => (key: string) => values[key]

  test('poprawna konfiguracja przechodzi', ({ assert }) => {
    assert.deepEqual(
      productionConfigProblems(
        env({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k', APP_URL: 'https://app.canvai.dev' })
      ),
      []
    )
  })

  test('atrapa AI, brak klucza i lokalny adres są błędami', ({ assert }) => {
    assert.lengthOf(productionConfigProblems(env({ APP_URL: 'https://app.canvai.dev' })), 1)
    assert.lengthOf(
      productionConfigProblems(env({ AI_PROVIDER: 'deepseek', APP_URL: 'http://localhost:3333' })),
      2
    )
    assert.deepEqual(
      productionConfigProblems(
        env({ AI_PROVIDER: 'mock', ALLOW_MOCK_AI: 'true', APP_URL: 'https://x.dev' })
      ),
      []
    )
  })

  test('pliki w S3 (ARC-4) wymagają bucketa i kluczy', ({ assert }) => {
    const base = {
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'k',
      APP_URL: 'https://app.canvai.dev',
    }
    assert.lengthOf(productionConfigProblems(env({ ...base, STORAGE_DRIVER: 's3' })), 3)
    assert.deepEqual(
      productionConfigProblems(
        env({
          ...base,
          STORAGE_DRIVER: 's3',
          STORAGE_S3_BUCKET: 'b',
          STORAGE_S3_ACCESS_KEY_ID: 'a',
          STORAGE_S3_SECRET_ACCESS_KEY: 's',
        })
      ),
      []
    )
  })
})
