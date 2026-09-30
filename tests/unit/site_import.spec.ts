import { test } from '@japa/runner'
import { assertPublicUrl, isBlockedAddress, UnsafeUrlError } from '#services/safe_fetch'
import { extractColors, extractFonts, normalizeColor, siteStyleNote } from '#services/site_import'

test.group('Site import / SSRF guard', () => {
  test('adresy prywatne, loopback i metadane chmury są blokowane', ({ assert }) => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      assert.isTrue(isBlockedAddress(ip), ip)
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      assert.isFalse(isBlockedAddress(ip), ip)
    }
  })

  test('URL: tylko http(s), bez localhost, danych logowania i dziwnych portów', ({ assert }) => {
    assert.equal(assertPublicUrl('https://example.com/a').hostname, 'example.com')
    for (const bad of [
      'file:///etc/passwd',
      'http://localhost/',
      'http://127.0.0.1/',
      'http://user:pw@example.com/',
      'http://example.com:22/',
      'http://metadata.internal/',
      'gopher://x',
    ]) {
      assert.throws(() => assertPublicUrl(bad), UnsafeUrlError as any)
    }
  })
})

test.group('Site import / CSS', () => {
  test('normalizacja kolorów', ({ assert }) => {
    assert.equal(normalizeColor('#FFF'), '#ffffff')
    assert.equal(normalizeColor('#016A71'), '#016a71')
    assert.equal(normalizeColor('rgb(1, 106, 113)'), '#016a71')
    assert.equal(normalizeColor('rgba(0,0,0,0.1)'), null, 'prawie przezroczysty pomijany')
    assert.equal(normalizeColor('#00000010'), null)
  })

  test('kolory: częstość, scalanie bliskich odcieni, nazwy zmiennych', ({ assert }) => {
    const css =
      ':root{--brand-accent:#016a71;--ink:#27251e} a{color:#016a71} b{color:#016b72} p{color:#27251e} .x{background:#c8702a}'
    const colors = extractColors(css)
    assert.equal(colors[0].hex, '#016a71')
    assert.equal(colors[0].variable, '--brand-accent')
    assert.equal(colors[0].count, 3, '#016b72 scalony z #016a71')
    assert.includeMembers(
      colors.map((c) => c.hex),
      ['#27251e', '#c8702a']
    )
  })

  test('fonty: Google Fonts i font-family, bez rodzin systemowych', ({ assert }) => {
    const html =
      '<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&amp;family=Inter+Tight&display=swap">'
    const css =
      'body{font-family:"Inter Tight", system-ui, sans-serif} h1{font-family: Fraunces, serif} code{font-family: ui-monospace, Menlo}'
    const fonts = extractFonts(css, html)
    assert.deepEqual(fonts.slice(0, 2).sort(), ['Fraunces', 'Inter Tight'])
    assert.notInclude(fonts, 'Menlo')

    const faces = extractFonts(
      '@font-face{font-family:"Inter Variable";src:url(a.woff2)} @font-face{font-family:"Inter Variable Fallback";src:local(Arial)} body{font-family:var(--font-sans)}',
      ''
    )
    assert.deepEqual(faces, ['Inter Variable'])
  })

  test('notatka stylu dla AI', ({ assert }) => {
    const note = siteStyleNote({
      url: 'https://acme.test/',
      host: 'acme.test',
      title: 'ACME',
      description: null,
      themeColor: '#016a71',
      colors: [{ hex: '#016a71', count: 3, variable: '--accent' }],
      fonts: ['Inter'],
      headings: ['Build faster'],
      ogImage: null,
      icon: null,
    })
    assert.include(note, 'WEBSITE REFERENCE — acme.test')
    assert.include(note, '#016a71 --accent')
    assert.include(note, 'Fonts: Inter')
  })
})
