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
  'ai.noKey': 'Generowanie AI nie jest skonfigurowane na serwerze (brak klucza API)',
  'ai.noKeyDeepseek': 'Generowanie AI nie jest skonfigurowane na serwerze (brak klucza API)',
  'ai.imageTooLarge': 'Obraz przekracza limit dostawcy ({mb} MiB)',
  'ai.tooManyImages': 'Za dużo obrazów w jednym zapytaniu do modelu',
  'ai.truncated': 'Odpowiedź modelu została ucięta (limit tokenów wyjścia)',
  'ai.emptyResponse': 'Model zwrócił pustą odpowiedź',
  'ai.unexpected': 'Nieoczekiwany błąd połączenia z dostawcą AI',
  'ai.noResponse': 'Dostawca AI nie odpowiedział',
  'ai.timeout': 'Przekroczono czas odpowiedzi dostawcy AI',
  'ai.noConnection': 'Brak połączenia z dostawcą AI',
  'ai.badKey': 'Dostawca AI odrzucił klucz API serwera',
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

  // Konto: maile
  'mail.greeting': 'Cześć{name},',
  'mail.linkFallback': 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  'mail.footer': 'Wiadomość wysłana automatycznie przez canvai. Nie odpowiadaj na nią.',
  'mail.verify.subject': 'Potwierdź adres e-mail — canvai',
  'mail.verify.heading': 'Potwierdź adres e-mail',
  'mail.verify.intro':
    'Dziękujemy za założenie konta w canvai. Kliknij przycisk, aby potwierdzić, że ten adres należy do Ciebie.',
  'mail.verify.button': 'Potwierdź adres e-mail',
  'mail.verify.expires': 'Link jest ważny przez 24 godziny.',
  'mail.verify.ignore': 'Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.',
  'mail.reset.subject': 'Reset hasła — canvai',
  'mail.reset.heading': 'Ustaw nowe hasło',
  'mail.reset.intro':
    'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk, aby ustawić nowe hasło.',
  'mail.reset.button': 'Ustaw nowe hasło',
  'mail.reset.expires': 'Link jest ważny przez 60 minut i można go użyć tylko raz.',
  'mail.reset.ignore':
    'Jeśli to nie Ty prosiłeś o reset, zignoruj tę wiadomość — hasło pozostanie bez zmian.',
  'mail.passwordChanged.subject': 'Hasło zostało zmienione — canvai',
  'mail.passwordChanged.heading': 'Hasło zostało zmienione',
  'mail.passwordChanged.intro': 'Hasło do Twojego konta canvai zostało właśnie zmienione.',
  'mail.passwordChanged.button': 'Przejdź do logowania',
  'mail.passwordChanged.ignore':
    'Jeśli to nie Ty zmieniłeś hasło, natychmiast je zresetuj przez „Nie pamiętasz hasła?”.',

  // Konto: komunikaty
  'account.verifySent': 'Wysłaliśmy link weryfikacyjny na adres {email}.',
  'account.verifyCooldown': 'Odczekaj chwilę przed ponowną wysyłką linku.',
  'account.verified': 'Adres e-mail został potwierdzony. Witaj w canvai!',
  'account.alreadyVerified': 'Adres e-mail jest już potwierdzony.',
  'account.verifyInvalid': 'Link weryfikacyjny jest nieprawidłowy lub wygasł. Wyślij nowy.',
  'account.resetSent':
    'Jeśli konto z tym adresem istnieje, wysłaliśmy na nie link do ustawienia nowego hasła.',
  'account.resetDone': 'Hasło zostało zmienione. Zaloguj się nowym hasłem.',
  'account.resetInvalid': 'Link do resetu hasła jest nieprawidłowy lub wygasł. Poproś o nowy.',
  'account.passwordChanged': 'Hasło zostało zmienione.',
  'account.currentPasswordWrong': 'Obecne hasło jest nieprawidłowe',
  'account.samePassword': 'Nowe hasło musi być inne niż obecne',
  'account.profileSaved': 'Zapisano zmiany w profilu.',
  'account.mailFailed': 'Nie udało się wysłać wiadomości e-mail. Spróbuj ponownie za chwilę.',
  'account.emailNotVerified': 'Potwierdź adres e-mail, aby korzystać z aplikacji.',
  'field.currentPassword': 'Obecne hasło',
  'field.token': 'Token',

  // Import strony
  'siteImport.failed':
    'Nie udało się pobrać tej strony (niedostępna, blokuje roboty albo to nie HTML).',
  'siteImport.linkNote': 'Strona referencyjna klienta — styl, kolory i fonty z tej witryny',
  'siteImport.imageNote': 'Obraz podglądu strony {host}',

  // Brand kity
  'brandKits.locked': 'Brand kity są dostępne w płatnych planach.',
  'brandKits.limit': 'Możesz mieć najwyżej {max} brand kitów.',

  'account.disabled': 'To konto zostało zablokowane. Skontaktuj się z pomocą: privacy@canvai.dev.',

  // Portal klienta
  'portal.locked': 'Portal klienta jest dostępny w płatnych planach.',
  'portal.notFound': 'Ten link jest nieaktywny albo wygasł.',
  'portal.uploadsOff': 'Właściciel wyłączył przesyłanie materiałów.',
  'portal.rateLimited': 'Za dużo przesłań w krótkim czasie — spróbuj za kilka minut.',
  'portal.tooMany': 'Najwyżej {max} plików naraz.',
  'portal.nothing': 'Dodaj plik, link albo notatkę.',
  'portal.noDoc': 'Nie ma jeszcze gotowego DESIGN.md do oceny.',
  'portal.mail.button': 'Otwórz tablicę',
  'portal.mail.materials.subject': '{name} przesłał(a) materiały do „{board}”',
  'portal.mail.materials.heading': 'Nowe materiały od klienta',
  'portal.mail.materials.intro':
    '{name} przesłał(a) {count} materiał(y) do tablicy „{board}”. Czekają w zakładce Materiały → Od klienta.',
  'portal.mail.approved.subject': '{name} zaakceptował(a) DESIGN.md — „{board}”',
  'portal.mail.approved.heading': 'DESIGN.md zaakceptowany',
  'portal.mail.approved.intro':
    '{name} zaakceptował(a) wersję v{version} DESIGN.md tablicy „{board}”.',
  'portal.mail.changes.subject': '{name} prosi o zmiany — „{board}”',
  'portal.mail.changes.heading': 'Klient prosi o zmiany',
  'portal.mail.changes.intro':
    '{name} prosi o zmiany w wersji v{version} DESIGN.md tablicy „{board}”:',

  // Rozliczenia
  'api.unauthorized': 'Brak lub nieprawidłowy token API (nagłówek Authorization: Bearer cvai_…)',
  'api.planRequired': 'API i serwer MCP są dostępne w płatnych planach (Pay as you go, Pro).',
  'api.tokenCreated': 'Token utworzony — skopiuj go teraz, później nie będzie widoczny.',
  'api.tokenRevoked': 'Token odwołany',
  'api.tokenLimit': 'Możesz mieć najwyżej {max} aktywnych tokenów.',
  'ai.previewInvalid': 'Model nie zwrócił poprawnego dokumentu HTML podglądu',
  'preview.needsReady': 'Podgląd powstaje z gotowej wersji DESIGN.md — najpierw ją wygeneruj.',
  'preview.needsSpec':
    'Ta wersja powstała przed wprowadzeniem podglądu — wygeneruj DESIGN.md ponownie.',
  'preview.inProgress': 'Podgląd tej wersji już się generuje.',
  'account.disposableEmail':
    'Tymczasowe skrzynki e-mail nie są obsługiwane — podaj swój stały adres.',
  'billing.insufficient':
    'Za mało kredytów: ta generacja kosztuje {needed}, a masz {balance}. Dokup kredyty w zakładce Rozliczenia.',
  'billing.proOnly': 'Tryb Pro reasoning jest dostępny w płatnych planach.',
  'billing.versionLocked':
    'Plan Free przechowuje tylko ostatnie wersje. Przejdź na płatny plan, aby otworzyć starsze.',
  'billing.exportsLocked': 'Eksport tokenów jest dostępny w płatnych planach.',
  'billing.exportNeedsRegen':
    'Ta wersja powstała przed wprowadzeniem eksportów — wygeneruj DESIGN.md ponownie.',
  'billing.boardLimit':
    'Plan Free obejmuje {limit} tablicę. Dokup kredyty albo przejdź na Pro, aby tworzyć kolejne.',
  'billing.materialsLimit':
    'Limit planu: {limit} materiałów na tablicę. Usuń część albo przejdź na płatny plan.',
  'billing.checkoutUnavailable': 'Płatności nie są jeszcze skonfigurowane. Spróbuj później.',
  'billing.checkoutFailed': 'Nie udało się otworzyć płatności. Spróbuj ponownie za chwilę.',
  'billing.alreadySubscribed': 'Masz już aktywną subskrypcję — zarządzaj nią w portalu klienta.',
  'billing.noSubscription': 'Nie masz subskrypcji.',
  'billing.portalFailed': 'Nie udało się otworzyć portalu klienta. Spróbuj ponownie za chwilę.',
  'billing.watermark': 'Wygenerowano w canvai (plan Free) — https://canvai.dev',
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

  'ai.noKey': 'AI generation is not configured on the server (missing API key)',
  'ai.noKeyDeepseek': 'AI generation is not configured on the server (missing API key)',
  'ai.imageTooLarge': 'Image exceeds the provider limit ({mb} MiB)',
  'ai.tooManyImages': 'Too many images in a single model request',
  'ai.truncated': 'The model response was cut off (output token limit)',
  'ai.emptyResponse': 'The model returned an empty response',
  'ai.unexpected': 'Unexpected error connecting to the AI provider',
  'ai.noResponse': 'The AI provider did not respond',
  'ai.timeout': 'The AI provider timed out',
  'ai.noConnection': 'Cannot connect to the AI provider',
  'ai.badKey': 'The AI provider rejected the server API key',
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

  'mail.greeting': 'Hi{name},',
  'mail.linkFallback': 'If the button does not work, copy this link into your browser:',
  'mail.footer': 'This message was sent automatically by canvai. Please do not reply.',
  'mail.verify.subject': 'Confirm your email — canvai',
  'mail.verify.heading': 'Confirm your email address',
  'mail.verify.intro':
    'Thanks for creating a canvai account. Click the button to confirm this address belongs to you.',
  'mail.verify.button': 'Confirm email address',
  'mail.verify.expires': 'The link is valid for 24 hours.',
  'mail.verify.ignore': 'If you did not create an account, you can ignore this email.',
  'mail.reset.subject': 'Reset your password — canvai',
  'mail.reset.heading': 'Set a new password',
  'mail.reset.intro':
    'We received a request to reset the password for your account. Click the button to set a new password.',
  'mail.reset.button': 'Set a new password',
  'mail.reset.expires': 'The link is valid for 60 minutes and can be used only once.',
  'mail.reset.ignore':
    'If you did not request a reset, ignore this email — your password stays unchanged.',
  'mail.passwordChanged.subject': 'Your password was changed — canvai',
  'mail.passwordChanged.heading': 'Your password was changed',
  'mail.passwordChanged.intro': 'The password for your canvai account has just been changed.',
  'mail.passwordChanged.button': 'Go to log in',
  'mail.passwordChanged.ignore':
    'If you did not change it, reset your password right away via “Forgot password?”.',

  'account.verifySent': 'We sent a verification link to {email}.',
  'account.verifyCooldown': 'Please wait a moment before requesting another link.',
  'account.verified': 'Your email is confirmed. Welcome to canvai!',
  'account.alreadyVerified': 'Your email is already confirmed.',
  'account.verifyInvalid': 'The verification link is invalid or has expired. Send a new one.',
  'account.resetSent':
    'If an account with this email exists, we sent it a link to set a new password.',
  'account.resetDone': 'Your password was changed. Log in with the new password.',
  'account.resetInvalid': 'The password reset link is invalid or has expired. Request a new one.',
  'account.passwordChanged': 'Your password was changed.',
  'account.currentPasswordWrong': 'The current password is incorrect',
  'account.samePassword': 'The new password must be different from the current one',
  'account.profileSaved': 'Profile saved.',
  'account.mailFailed': 'We could not send the email. Please try again in a moment.',
  'account.emailNotVerified': 'Confirm your email address to use the app.',
  'field.currentPassword': 'Current password',
  'field.token': 'Token',

  // Site import
  'siteImport.failed': 'Could not fetch this page (unavailable, blocks bots, or not HTML).',
  'siteImport.linkNote': 'Client reference website — style, colors and fonts of this site',
  'siteImport.imageNote': 'Preview image of {host}',

  // Brand kits
  'brandKits.locked': 'Brand kits are available on paid plans.',
  'brandKits.limit': 'You can have at most {max} brand kits.',

  'account.disabled': 'This account has been disabled. Contact support: privacy@canvai.dev.',

  // Client portal
  'portal.locked': 'The client portal is available on paid plans.',
  'portal.notFound': 'This link is inactive or has expired.',
  'portal.uploadsOff': 'The owner has turned off uploads.',
  'portal.rateLimited': 'Too many submissions in a short time — please try again in a few minutes.',
  'portal.tooMany': 'At most {max} files at once.',
  'portal.nothing': 'Add a file, a link or a note.',
  'portal.noDoc': 'There is no ready DESIGN.md to review yet.',
  'portal.mail.button': 'Open the board',
  'portal.mail.materials.subject': '{name} sent materials to “{board}”',
  'portal.mail.materials.heading': 'New materials from your client',
  'portal.mail.materials.intro':
    '{name} sent {count} material(s) to the board “{board}”. They are waiting in Materials → From client.',
  'portal.mail.approved.subject': '{name} approved the DESIGN.md — “{board}”',
  'portal.mail.approved.heading': 'DESIGN.md approved',
  'portal.mail.approved.intro':
    '{name} approved version v{version} of the DESIGN.md for “{board}”.',
  'portal.mail.changes.subject': '{name} requested changes — “{board}”',
  'portal.mail.changes.heading': 'Your client requested changes',
  'portal.mail.changes.intro':
    '{name} requested changes to version v{version} of the DESIGN.md for “{board}”:',

  // Billing
  'api.unauthorized': 'Missing or invalid API token (Authorization: Bearer cvai_… header)',
  'api.planRequired': 'The API and MCP server are available on paid plans (Pay as you go, Pro).',
  'api.tokenCreated': 'Token created — copy it now, it will not be shown again.',
  'api.tokenRevoked': 'Token revoked',
  'api.tokenLimit': 'You can have at most {max} active tokens.',
  'ai.previewInvalid': 'The model did not return a valid HTML preview document',
  'preview.needsReady': 'Previews are built from a ready DESIGN.md version — generate one first.',
  'preview.needsSpec': 'This version predates previews — generate DESIGN.md again.',
  'preview.inProgress': 'A preview of this version is already being generated.',
  'account.disposableEmail':
    'Temporary email addresses are not supported — please use your regular address.',
  'billing.insufficient':
    'Not enough credits: this generation costs {needed} and you have {balance}. Top up in Billing.',
  'billing.proOnly': 'Pro reasoning is available on paid plans.',
  'billing.versionLocked':
    'The Free plan keeps only the latest versions. Upgrade to open older ones.',
  'billing.exportsLocked': 'Token export is available on paid plans.',
  'billing.exportNeedsRegen':
    'This version was created before exports existed — generate DESIGN.md again.',
  'billing.boardLimit':
    'The Free plan includes {limit} board. Buy credits or upgrade to Pro to create more.',
  'billing.materialsLimit':
    'Plan limit: {limit} materials per board. Remove some or upgrade to a paid plan.',
  'billing.checkoutUnavailable': 'Payments are not configured yet. Please try again later.',
  'billing.checkoutFailed': 'Could not open checkout. Please try again in a moment.',
  'billing.alreadySubscribed':
    'You already have an active subscription — manage it in the customer portal.',
  'billing.noSubscription': 'You have no subscription.',
  'billing.portalFailed': 'Could not open the customer portal. Please try again in a moment.',
  'billing.watermark': 'Generated with canvai (Free plan) — https://canvai.dev',
}
