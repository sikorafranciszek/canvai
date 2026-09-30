/*
|--------------------------------------------------------------------------
| Validator file
|--------------------------------------------------------------------------
|
| The validator file is used for configuring global transforms for VineJS.
| The transform below converts all VineJS date outputs from JavaScript
| Date objects to Luxon DateTime instances, so that validated dates are
| ready to use with Lucid models and other parts of the app that expect
| Luxon DateTime.
|
*/

import { DateTime } from 'luxon'
import vine, { SimpleMessagesProvider, VineDate } from '@vinejs/vine'
import type { MessagesProviderContact } from '@vinejs/vine/types'
import { createTranslator, type Locale } from '#shared/i18n'
import { currentLocale } from '#services/i18n'
import { en, pl, type ServerMessageKey } from '#services/i18n_messages'

declare module '@vinejs/vine/types' {
  interface VineGlobalTransforms {
    date: DateTime
  }
}

VineDate.transform((value) => DateTime.fromJSDate(value))

/**
 * Komunikaty walidacji w języku żądania (PL/EN). Dostawca wybiera słownik na
 * podstawie `currentLocale()` — ustawianego przez `LocaleMiddleware`.
 */
function buildProvider(locale: Locale) {
  const tr = (key: ServerMessageKey) => translator.t(locale, key)
  // VineJS podstawia {{ field }}, {{ min }}, {{ max }}.
  const vineTemplate = (key: ServerMessageKey) =>
    tr(key)
      .replace('{field}', '{{ field }}')
      .replace('{min}', '{{ min }}')
      .replace('{max}', '{{ max }}')
  return new SimpleMessagesProvider(
    {
      'required': tr('validation.required'),
      'string': tr('validation.string'),
      'email': tr('validation.email'),
      'minLength': vineTemplate('validation.minLength'),
      'maxLength': vineTemplate('validation.maxLength'),
      'confirmed': tr('validation.confirmed'),
      'database.unique': tr('validation.unique'),
      'url': tr('validation.url'),
      'boolean': tr('validation.invalid'),
      'number': tr('validation.number'),
      'enum': tr('validation.invalid'),
    },
    {
      fullName: tr('field.fullName'),
      email: tr('field.email'),
      password: tr('field.password'),
      passwordConfirmation: tr('field.passwordConfirmation'),
      title: tr('field.title'),
      note: tr('field.note'),
    }
  )
}

const translator = createTranslator({ pl, en })
const providers: Record<Locale, SimpleMessagesProvider> = {
  pl: buildProvider('pl'),
  en: buildProvider('en'),
}

class LocaleMessagesProvider implements MessagesProviderContact {
  getMessage(...args: Parameters<MessagesProviderContact['getMessage']>) {
    return providers[currentLocale()].getMessage(...args)
  }
}

vine.messagesProvider = new LocaleMessagesProvider()
