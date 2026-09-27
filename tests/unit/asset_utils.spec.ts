import { test } from '@japa/runner'
import {
  assetKindLabel,
  formatBytes,
  isDangerousMime,
  isHttpUrl,
  MAX_UPLOAD_BYTES,
  validateClientFile,
} from '#shared/asset-utils'

test.group('asset-utils (walidacja klienta + formatowanie)', () => {
  test('formatBytes — formatuje czytelnie', ({ assert }) => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(1024), '1.0 KB')
    assert.equal(formatBytes(20 * 1024 * 1024), '20 MB')
    assert.equal(formatBytes(null), '—')
  })

  test('validateClientFile — akceptuje obrazy i PDF', ({ assert }) => {
    assert.deepEqual(validateClientFile({ size: 100, type: 'image/png' }), { ok: true })
    assert.deepEqual(validateClientFile({ size: 100, type: 'image/svg+xml' }), { ok: true })
    assert.deepEqual(validateClientFile({ size: 100, type: 'application/pdf' }), { ok: true })
  })

  test('validateClientFile — odrzuca za duży plik', ({ assert }) => {
    const verdict = validateClientFile({ size: MAX_UPLOAD_BYTES + 1, type: 'image/png' })
    assert.deepEqual(verdict, { ok: false, reason: 'too_large' })
  })

  test('validateClientFile — odrzuca niebezpieczny typ (HTML)', ({ assert }) => {
    assert.deepEqual(validateClientFile({ size: 10, type: 'text/html' }), {
      ok: false,
      reason: 'dangerous',
    })
  })

  test('validateClientFile — odrzuca nieobsługiwany typ', ({ assert }) => {
    assert.deepEqual(validateClientFile({ size: 10, type: 'application/zip' }), {
      ok: false,
      reason: 'unsupported',
    })
  })

  test('isDangerousMime — wektory XSS', ({ assert }) => {
    assert.isTrue(isDangerousMime('text/javascript'))
    assert.isFalse(isDangerousMime('image/png'))
  })

  test('isHttpUrl — rozpoznaje linki http/https', ({ assert }) => {
    assert.isTrue(isHttpUrl('https://example.com'))
    assert.isTrue(isHttpUrl('http://example.com/a?b=1'))
    assert.isFalse(isHttpUrl('zwykły tekst'))
    assert.isFalse(isHttpUrl('ftp://example.com'))
    assert.isFalse(isHttpUrl('example.com'))
  })

  test('assetKindLabel — etykiety per rodzaj', ({ assert }) => {
    assert.equal(assetKindLabel('image'), 'Obraz')
    assert.equal(assetKindLabel('pdf'), 'PDF')
    assert.equal(assetKindLabel('link'), 'Link')
    assert.equal(assetKindLabel('file'), 'Plik')
    assert.equal(assetKindLabel('coś-innego'), 'coś-innego')
  })
})
