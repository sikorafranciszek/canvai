import { test } from '@japa/runner'
import { mailSafe } from '#services/mail_safe'

test.group('mailSafe (SEC-8)', () => {
  test('bez znaków sterujących, linków i ponad limit', ({ assert }) => {
    assert.equal(mailSafe('Sklep\r\nBcc: x'), 'Sklep Bcc: x')
    const out = mailSafe('Odbierz na https://evil.example/win albo www.bad.pl')
    assert.notMatch(out, /https?:|evil\.example|www\.bad\.pl/)
    assert.include(out, 'evil\u2024example')
    assert.equal(mailSafe('Sklep v2.0 — kawa'), 'Sklep v2.0 — kawa')
    assert.equal(mailSafe('a'.repeat(100), 10).length, 10)
  })
})
