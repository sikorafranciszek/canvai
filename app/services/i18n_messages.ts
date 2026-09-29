/**
 * Słownik komunikatów serwera (PL/EN): walidacja, błędy API, komunikaty
 * generacji DESIGN.md. Klucze płaskie; `en` musi mieć komplet kluczy `pl`.
 */

export const pl = {
  // Walidacja (VineJS)
  'validation.required': 'To pole jest wymagane',
  'validation.string': 'Wartość musi być tekstem',
  'validation.email': 'Podaj poprawny adres e-mail',
  'validation.minLength': '{field} musi mieć co najmniej {min} znaków',
  'validation.maxLength': '{field} może mieć najwyżej {max} znaków',
  'validation.confirmed': 'Hasła nie są takie same',
  'validation.unique': 'Konto z tym adresem e-mail już istnieje',
  'validation.url': 'Podaj poprawny adres URL',
  'validation.invalid': 'Nieprawidłowa wartość',
  'validation.number': 'Wartość musi być liczbą',
  'field.fullName': 'Imię i nazwisko',
  'field.email': 'E-mail',
  'field.password': 'Hasło',
  'field.passwordConfirmation': 'Powtórzone hasło',
  'field.title': 'Nazwa',
  'field.note': 'Notatka',

  // Auth
  'auth.invalidCredentials': 'Nieprawidłowy e-mail lub hasło',

  // Assety
  'asset.noFiles': 'Brak plików w polu „files”',
  'asset.urlRequired': 'Podaj adres URL linku',
  'asset.forbiddenMime': 'Niedozwolony typ pliku: {mime}',
  'asset.readFailed': 'Nie udało się odczytać przesłanego pliku',
  'asset.tooLarge': 'Plik „{name}” przekracza limit rozmiaru',
  'asset.mismatch':
    'Zawartość pliku „{name}” nie zgadza się z zadeklarowanym typem {mime} ({detail})',
  'asset.mismatch.noSvg': 'brak elementu <svg>',
  'asset.mismatch.unreadable': 'nie udało się odczytać pliku jako obrazu',
  'asset.mismatch.detected': 'wykryty format: {format}',
  'asset.mismatch.unknown': 'nieznany',

  // DESIGN.md — API
  'doc.inProgress': 'Generacja DESIGN.md dla tej tablicy już trwa',
  'doc.emptyBoard': 'Tablica jest pusta — dodaj zrzuty ekranu, obrazy, linki albo notatki',
  'doc.tooManyAssets':
    'Tablica ma {count} materiałów, a limit jednej generacji to {limit}. Usuń część materiałów albo podnieś limit w config/ai.ts.',

  // Generacja
  'gen.notGrounded': 'Model nie wygenerował poprawnie ugruntowanego dokumentu: {errors}',
  'gen.tokenLimit':
    'Przekroczono limit tokenów na generację ({total} > {limit}). Zmniejsz liczbę materiałów albo podnieś limit w config/ai.ts.',
  'gen.assetFailed': 'Nie udało się przeanalizować materiału A{id} („{name}”): {reason}',
  'gen.unexpected': 'Nieoczekiwany błąd generacji',
  'gen.retrying': 'Ponawianie: {message}',
  'gen.interrupted': 'Generacja została przerwana (restart serwera?) — spróbuj ponownie',
  'gen.interruptedRetry': 'Zadanie przerwane — ponawianie',
  'gen.interruptedTooMany': 'Zadanie przerwane zbyt wiele razy',
  'gen.unknownError': 'nieznany błąd',

  // Dostawca AI
  'ai.noKey':
    'Brak klucza DEEPSEEK_API_KEY w pliku .env — ustaw klucz albo przełącz AI_PROVIDER=mock',
  'ai.noKeyDeepseek':
    'Brak klucza DEEPSEEK_API_KEY w .env — generacja przez DeepSeek jest niedostępna',
  'ai.imageTooLarge': 'Obraz przekracza limit dostawcy ({mb} MiB)',
  'ai.tooManyImages': 'Za dużo obrazów w jednym zapytaniu do modelu',
  'ai.truncated': 'Odpowiedź modelu została ucięta (limit tokenów wyjścia)',
  'ai.emptyResponse': 'Model zwrócił pustą odpowiedź',
  'ai.unexpected': 'Nieoczekiwany błąd połączenia z dostawcą AI',
  'ai.noResponse': 'Dostawca AI nie odpowiedział',
  'ai.timeout': 'Przekroczono czas odpowiedzi dostawcy AI',
  'ai.noConnection': 'Brak połączenia z dostawcą AI',
  'ai.badKey': 'Dostawca AI odrzucił klucz API (sprawdź DEEPSEEK_API_KEY)',
  'ai.noCredit': 'Brak środków na koncie dostawcy AI',
  'ai.rateLimited': 'Dostawca AI ogranicza liczbę zapytań (429)',
  'ai.unavailable': 'Dostawca AI jest chwilowo niedostępny ({status})',
  'ai.rejected': 'Dostawca AI odrzucił zapytanie ({status})',
  'ai.invalidJson': 'Model zwrócił odpowiedź, która nie jest poprawnym JSON-em',
  'ai.jsonNotObject': 'Model zwrócił JSON, który nie jest obiektem',
  'ai.analysisNotObject': 'Analiza materiału: oczekiwano obiektu',
  'ai.analysisNoSummary': 'Analiza materiału: brak pola „summary”',

  // Specyfikacja (kontrola jakości odpowiedzi modelu)
  'spec.notObject': 'Specyfikacja: oczekiwano obiektu JSON',
  'spec.incomplete': 'Specyfikacja niekompletna: {problems}',
  'spec.problem.colors': 'colors: wymagany co najmniej jeden kolor z poprawnym hex',
  'spec.problem.families': 'typography.families: wymagana co najmniej jedna rodzina fontów',
  'spec.problem.components': 'components: wymagany co najmniej jeden komponent',
  'spec.problem.name': 'name: brak nazwy produktu/marki',
  'spec.problem.overview': 'overview: brak opisu',
  'spec.problem.dosDonts': 'dos/donts: wymagane obie listy',
  'spec.unknownRefs': '{where} odwołuje się do nieistniejących materiałów: {ids}',
  'spec.noSources':
    'Specyfikacja nie wskazuje żadnego materiału źródłowego (pola sources / [A<id>])',
  'spec.where.color': 'Kolor „{name}”',
  'spec.where.font': 'Font „{name}”',
  'spec.where.component': 'Komponent „{name}”',
  'spec.where.screen': 'Ekran „{name}”',
  'spec.where.text': 'Tekst',
} as const

export type ServerMessageKey = keyof typeof pl

export const en: Record<ServerMessageKey, string> = {
  'validation.required': 'This field is required',
  'validation.string': 'The value must be text',
  'validation.email': 'Enter a valid email address',
  'validation.minLength': '{field} must be at least {min} characters',
  'validation.maxLength': '{field} must be at most {max} characters',
  'validation.confirmed': 'Passwords do not match',
  'validation.unique': 'An account with this email already exists',
  'validation.url': 'Enter a valid URL',
  'validation.invalid': 'Invalid value',
  'validation.number': 'The value must be a number',
  'field.fullName': 'Full name',
  'field.email': 'Email',
  'field.password': 'Password',
  'field.passwordConfirmation': 'Password confirmation',
  'field.title': 'Name',
  'field.note': 'Note',

  'auth.invalidCredentials': 'Invalid email or password',

  'asset.noFiles': 'No files in the “files” field',
  'asset.urlRequired': 'Enter the link URL',
  'asset.forbiddenMime': 'File type not allowed: {mime}',
  'asset.readFailed': 'Could not read the uploaded file',
  'asset.tooLarge': 'File “{name}” exceeds the size limit',
  'asset.mismatch': 'The content of “{name}” does not match the declared type {mime} ({detail})',
  'asset.mismatch.noSvg': 'no <svg> element',
  'asset.mismatch.unreadable': 'the file could not be read as an image',
  'asset.mismatch.detected': 'detected format: {format}',
  'asset.mismatch.unknown': 'unknown',

  'doc.inProgress': 'DESIGN.md generation for this board is already running',
  'doc.emptyBoard': 'The board is empty — add screenshots, images, links or notes',
  'doc.tooManyAssets':
    'The board has {count} materials and the per-generation limit is {limit}. Remove some materials or raise the limit in config/ai.ts.',

  'gen.notGrounded': 'The model did not produce a properly grounded document: {errors}',
  'gen.tokenLimit':
    'Token limit per generation exceeded ({total} > {limit}). Reduce the number of materials or raise the limit in config/ai.ts.',
  'gen.assetFailed': 'Could not analyse material A{id} (“{name}”): {reason}',
  'gen.unexpected': 'Unexpected generation error',
  'gen.retrying': 'Retrying: {message}',
  'gen.interrupted': 'Generation was interrupted (server restart?) — please try again',
  'gen.interruptedRetry': 'Job interrupted — retrying',
  'gen.interruptedTooMany': 'Job interrupted too many times',
  'gen.unknownError': 'unknown error',

  'ai.noKey': 'DEEPSEEK_API_KEY is missing in .env — set the key or switch to AI_PROVIDER=mock',
  'ai.noKeyDeepseek': 'DEEPSEEK_API_KEY is missing in .env — DeepSeek generation is unavailable',
  'ai.imageTooLarge': 'Image exceeds the provider limit ({mb} MiB)',
  'ai.tooManyImages': 'Too many images in a single model request',
  'ai.truncated': 'The model response was cut off (output token limit)',
  'ai.emptyResponse': 'The model returned an empty response',
  'ai.unexpected': 'Unexpected error connecting to the AI provider',
  'ai.noResponse': 'The AI provider did not respond',
  'ai.timeout': 'The AI provider timed out',
  'ai.noConnection': 'Cannot connect to the AI provider',
  'ai.badKey': 'The AI provider rejected the API key (check DEEPSEEK_API_KEY)',
  'ai.noCredit': 'Insufficient balance on the AI provider account',
  'ai.rateLimited': 'The AI provider is rate limiting requests (429)',
  'ai.unavailable': 'The AI provider is temporarily unavailable ({status})',
  'ai.rejected': 'The AI provider rejected the request ({status})',
  'ai.invalidJson': 'The model returned a response that is not valid JSON',
  'ai.jsonNotObject': 'The model returned JSON that is not an object',
  'ai.analysisNotObject': 'Material analysis: expected an object',
  'ai.analysisNoSummary': 'Material analysis: missing “summary” field',

  'spec.notObject': 'Specification: expected a JSON object',
  'spec.incomplete': 'Incomplete specification: {problems}',
  'spec.problem.colors': 'colors: at least one color with a valid hex is required',
  'spec.problem.families': 'typography.families: at least one font family is required',
  'spec.problem.components': 'components: at least one component is required',
  'spec.problem.name': 'name: product/brand name is missing',
  'spec.problem.overview': 'overview: description is missing',
  'spec.problem.dosDonts': 'dos/donts: both lists are required',
  'spec.unknownRefs': '{where} references materials that do not exist: {ids}',
  'spec.noSources': 'The specification does not cite any source material (sources / [A<id>])',
  'spec.where.color': 'Color “{name}”',
  'spec.where.font': 'Font “{name}”',
  'spec.where.component': 'Component “{name}”',
  'spec.where.screen': 'Screen “{name}”',
  'spec.where.text': 'Text',
}
