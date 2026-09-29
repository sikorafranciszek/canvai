import { test } from '@japa/runner'
import {
  createTranslator,
  interpolate,
  localeFromAcceptLanguage,
  resolveLocale,
} from '#shared/i18n'
import { en as serverEn, pl as serverPl } from '#services/i18n_messages'
import { currentLocale, runWithLocale, t } from '#services/i18n'

test.group('i18n', () => {
  test('język: cookie > Accept-Language (polski → PL, inny → EN)', ({ assert }) => {
    assert.equal(resolveLocale('en', 'pl-PL'), 'en')
    assert.equal(resolveLocale('de', 'en-US,en;q=0.9'), 'en')
    assert.equal(resolveLocale(undefined, 'de-DE,pl;q=0.5,en;q=0.8'), 'en')
    // Przeglądarka po polsku → PL, w innym języku → EN, bez nagłówka → PL.
    assert.equal(resolveLocale(undefined, 'pl-PL,pl;q=0.9,en;q=0.8'), 'pl')
    assert.equal(resolveLocale(undefined, 'de-DE,fr'), 'en')
    assert.equal(resolveLocale(undefined, 'uk-UA'), 'en')
    assert.equal(resolveLocale(undefined, null), 'pl')
    // Obca wartość cookie (np. z innej aplikacji na localhost) jest ignorowana.
    assert.equal(resolveLocale('pl-PL', 'en-US'), 'en')
    assert.isNull(localeFromAcceptLanguage(''))
  })

  test('interpolacja i odmiana liczebników PL/EN', ({ assert }) => {
    assert.equal(
      interpolate('Plik {name} ({missing})', { name: 'a.png' }),
      'Plik a.png ({missing})'
    )
    const { t: tr, tp } = createTranslator({
      pl: {
        'n.one': '{n} materiał',
        'n.few': '{n} materiały',
        'n.many': '{n} materiałów',
        'n.other': '{n} materiału',
      },
      en: { 'n.one': '{n} material', 'n.few': '', 'n.many': '', 'n.other': '{n} materials' },
    })
    assert.deepEqual(
      [1, 2, 5, 22, 25].map((n) => tp('pl', 'n', n)),
      ['1 materiał', '2 materiały', '5 materiałów', '22 materiały', '25 materiałów']
    )
    assert.deepEqual(
      [1, 2, 5].map((n) => tp('en', 'n', n)),
      ['1 material', '2 materials', '5 materials']
    )
    assert.equal(tr('en', 'brak.klucza' as never), 'brak.klucza')
  })

  test('słowniki serwera PL i EN mają ten sam komplet kluczy', ({ assert }) => {
    assert.sameMembers(Object.keys(serverEn), Object.keys(serverPl))
    for (const value of Object.values(serverEn)) assert.isAbove(value.length, 0)
  })

  test('t() na serwerze mówi językiem kontekstu (AsyncLocalStorage)', async ({ assert }) => {
    assert.equal(currentLocale(), 'pl')
    assert.equal(t('doc.emptyBoard').slice(0, 7), 'Tablica')
    const inner = await runWithLocale('en', async () => {
      await new Promise((r) => setTimeout(r, 1))
      return t('ai.rejected', { status: 400 })
    })
    assert.equal(inner, 'The AI provider rejected the request (400)')
  })
})
