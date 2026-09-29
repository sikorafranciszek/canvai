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

declare module '@vinejs/vine/types' {
  interface VineGlobalTransforms {
    date: DateTime
  }
}

VineDate.transform((value) => DateTime.fromJSDate(value))

/**
 * Komunikaty walidacji po polsku (UI aplikacji jest po polsku). Nazwy pól
 * mapowane na etykiety widoczne w formularzach.
 */

vine.messagesProvider = new SimpleMessagesProvider(
  {
    'required': 'To pole jest wymagane',
    'string': 'Wartość musi być tekstem',
    'email': 'Podaj poprawny adres e-mail',
    'minLength': '{{ field }} musi mieć co najmniej {{ min }} znaków',
    'maxLength': '{{ field }} może mieć najwyżej {{ max }} znaków',
    'confirmed': 'Hasła nie są takie same',
    'database.unique': 'Konto z tym adresem e-mail już istnieje',
    'url': 'Podaj poprawny adres URL',
    'boolean': 'Nieprawidłowa wartość',
    'number': 'Wartość musi być liczbą',
    'enum': 'Nieprawidłowa wartość',
  },
  {
    fullName: 'Imię i nazwisko',
    email: 'E-mail',
    password: 'Hasło',
    passwordConfirmation: 'Powtórzone hasło',
    title: 'Nazwa',
    note: 'Notatka',
  }
)
