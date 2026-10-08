import { test } from '@japa/runner'
import { assertPublicUrl, isBlockedAddress } from '#services/safe_fetch'

test.group('SSRF: klasyfikacja adresów (SEC-2)', () => {
  test('wszystkie zapisy adresów lokalnych i prywatnych są blokowane', ({ assert }) => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '169.254.169.254',
      '0.0.0.0',
      '::',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '0:0:0:0:0:ffff:0a00:0005',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '64:ff9b::808:808',
      '2002:7f00:1::',
      '2001:0:4136:e378::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
      '100::1',
    ]) {
      assert.isTrue(isBlockedAddress(ip), ip)
    }
  })

  test('publiczne adresy przechodzą', ({ assert }) => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '::ffff:8.8.8.8',
      '::ffff:808:808',
      '2606:4700::1111',
      '2a00:1450:4001::64',
    ]) {
      assert.isFalse(isBlockedAddress(ip), ip)
    }
  })

  test('URL z adresem IPv6 w nawiasach (także po normalizacji przez URL)', ({ assert }) => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]:8080/',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data',
      'http://[64:ff9b::a9fe:a9fe]/',
      'http://127.1/',
      'http://0x7f.0.0.1/',
      'http://2130706433/',
    ]) {
      let blocked = false
      try {
        assertPublicUrl(url)
      } catch {
        blocked = true
      }
      assert.isTrue(blocked, url)
    }
    assert.doesNotThrow(() => assertPublicUrl('https://example.com/a'))
  })
})
