import { test } from '@japa/runner'
import { allowedOnHost } from '#middleware/host_middleware'

test.group('Hosty (SEC-10)', () => {
  test('na obcym hoście tylko portal, logo i health', ({ assert }) => {
    assert.isTrue(allowedOnHost('localhost', '/login'))
    assert.isTrue(allowedOnHost('crm.localhost', '/'))
    assert.isTrue(allowedOnHost('projekty.agencja.pl', '/c/abcdefghijklmnopqrstuv'))
    assert.isTrue(allowedOnHost('projekty.agencja.pl', '/c/abcdefghijklmnopqrstuv/feedback'))
    assert.isTrue(allowedOnHost('projekty.agencja.pl', '/brand/12/logo'))
    assert.isTrue(allowedOnHost('projekty.agencja.pl', '/health'))
    assert.isFalse(allowedOnHost('projekty.agencja.pl', '/login'))
    assert.isFalse(allowedOnHost('projekty.agencja.pl', '/boards/1'))
    assert.isFalse(allowedOnHost('projekty.agencja.pl', '/c/x/../../login'))
    assert.isFalse(allowedOnHost('evil.example', '/api/boards'))
  })
})
