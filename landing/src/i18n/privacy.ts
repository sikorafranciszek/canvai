/**
 * Polityka prywatności canvai.dev i app.canvai.dev (PL/EN).
 *
 * UWAGA: `LEGAL.controller` musi zawierać pełną nazwę administratora danych
 * (firma / imię i nazwisko przedsiębiorcy) z adresem — wymaga tego art. 13 RODO.
 */
import type { Lang } from './content'

export const LEGAL = {
  /** Administrator danych — do uzupełnienia pełną nazwą i adresem. */
  controller: 'canvai',
  email: 'privacy@canvai.dev',
  updated: { pl: '30 września 2026', en: 'September 30, 2026' },
}

export const PRIVACY_PATH: Record<Lang, string> = { en: '/privacy/', pl: '/pl/prywatnosc/' }

export interface PolicySection {
  id: string
  title: string
  body?: string[]
  list?: string[]
  table?: { head: string[]; rows: string[][] }
}

export interface PrivacyContent {
  title: string
  metaDescription: string
  intro: string
  updatedLabel: string
  tocLabel: string
  sections: PolicySection[]
}

const pl: PrivacyContent = {
  title: 'Polityka prywatności',
  metaDescription:
    'Jak canvai przetwarza dane osobowe, jakich używa cookies i narzędzi analitycznych oraz jakie masz prawa.',
  intro:
    'Ta polityka opisuje, jak przetwarzamy dane osobowe w serwisie canvai.dev (strona produktu) i w aplikacji app.canvai.dev. Piszemy prosto i konkretnie — jeśli coś jest niejasne, napisz do nas.',
  updatedLabel: 'Ostatnia aktualizacja',
  tocLabel: 'Spis treści',
  sections: [
    {
      id: 'administrator',
      title: '1. Administrator danych',
      body: [
        `Administratorem Twoich danych osobowych jest ${LEGAL.controller}. We wszystkich sprawach dotyczących danych osobowych napisz na ${LEGAL.email}.`,
      ],
    },
    {
      id: 'dane',
      title: '2. Jakie dane przetwarzamy i po co',
      table: {
        head: ['Dane', 'Cel', 'Podstawa prawna'],
        rows: [
          [
            'Konto: e-mail, imię i nazwisko (opcjonalnie), hash hasła, preferowany język',
            'Założenie i obsługa konta, logowanie, weryfikacja e-mail, reset hasła',
            'Wykonanie umowy (art. 6 ust. 1 lit. b RODO)',
          ],
          [
            'Treści, które dodajesz: tablice, obrazy, pliki, linki, notatki, wygenerowane dokumenty DESIGN.md',
            'Świadczenie usługi: przechowywanie tablic i generowanie specyfikacji przez AI',
            'Wykonanie umowy (art. 6 ust. 1 lit. b)',
          ],
          [
            'Dane rozliczeniowe: plan, saldo i historia kredytów, identyfikatory zamówień i subskrypcji',
            'Rozliczanie kredytów i planów, obsługa płatności i zwrotów',
            'Wykonanie umowy (lit. b) i obowiązki prawne (lit. c)',
          ],
          [
            'Dane techniczne: adres IP, logi serwera, dane urządzenia i przeglądarki',
            'Bezpieczeństwo, zapobieganie nadużyciom, diagnozowanie błędów',
            'Prawnie uzasadniony interes (lit. f)',
          ],
          [
            'Dane analityczne Microsoft Clarity: kliknięcia, przewijanie, nagrania sesji (bez treści pól formularzy)',
            'Ulepszanie strony i aplikacji',
            'Zgoda (lit. a) — tylko po jej wyrażeniu',
          ],
          [
            'Polecenia: kto kogo polecił, przyznane bonusy',
            'Program poleceń',
            'Wykonanie umowy (lit. b)',
          ],
        ],
      },
    },
    {
      id: 'ai',
      title: '3. Przetwarzanie przez AI',
      body: [
        'Żeby wygenerować DESIGN.md i podgląd UI, materiały z tablicy (obrazy, teksty, notatki, metadane linków) wysyłamy do dostawcy modelu AI — obecnie DeepSeek (Hangzhou DeepSeek Artificial Intelligence Co., Ltd., Chiny). Dane trafiają więc poza Europejski Obszar Gospodarczy, do państwa, dla którego Komisja Europejska nie wydała decyzji stwierdzającej odpowiedni stopień ochrony danych.',
        'Materiały wysyłamy tylko wtedy, gdy uruchomisz generowanie. Nie dodawaj na tablice danych osobowych, których nie chcesz przekazywać dostawcy AI (np. zrzutów ekranu z danymi klientów).',
      ],
    },
    {
      id: 'odbiorcy',
      title: '4. Komu powierzamy dane',
      body: ['Korzystamy z usług zaufanych dostawców, którzy przetwarzają dane w naszym imieniu lub jako samodzielni administratorzy:'],
      list: [
        'Contabo GmbH — serwer aplikacji app.canvai.dev (centrum danych we Francji, UE).',
        'Cloudflare, Inc. — hosting i sieć CDN strony canvai.dev, DNS.',
        'DeepSeek — analiza materiałów i generowanie treści przez AI (patrz pkt 3).',
        'Dostawca poczty transakcyjnej (np. Resend) — wysyłka wiadomości e-mail z konta.',
        'Polar Software, Inc. (polar.sh) — sprzedawca i operator płatności (Merchant of Record). Polar samodzielnie przetwarza dane płatnicze i wystawia faktury; nie widzimy numerów kart.',
        'Microsoft Corporation — Microsoft Clarity, analityka zachowań (tylko za zgodą).',
      ],
    },
    {
      id: 'transfery',
      title: '5. Przekazywanie danych poza EOG',
      body: [
        'Cloudflare, Microsoft i Polar mogą przetwarzać dane w USA — na podstawie EU-US Data Privacy Framework lub standardowych klauzul umownych. Przekazywanie danych do DeepSeek (Chiny) opisujemy w pkt 3.',
      ],
    },
    {
      id: 'klienci',
      title: '6. Portal klienta',
      body: [
        'Użytkownicy canvai mogą udostępnić swoim klientom portal do przesyłania materiałów i akceptacji DESIGN.md. Dane przesłane przez portal (imię lub nazwa, pliki, linki, komentarze) przetwarzamy na zlecenie użytkownika, który udostępnił link — to on jest administratorem tych danych.',
      ],
    },
    {
      id: 'cookies',
      title: '7. Pliki cookies',
      body: [
        'Niezbędne cookies ustawiamy zawsze — bez nich logowanie i bezpieczeństwo nie działają. Cookies analityczne Microsoft Clarity ustawiamy wyłącznie po Twojej zgodzie. Zgodę zmienisz lub wycofasz w każdej chwili przez link „Ustawienia cookies” w stopce.',
      ],
      table: {
        head: ['Cookie', 'Serwis', 'Cel', 'Ważność'],
        rows: [
          ['canvai_consent', 'canvai.dev, app.canvai.dev', 'Zapamiętanie decyzji o cookies', '180 dni'],
          ['canvai_lang', 'canvai.dev', 'Wybrany język strony', '1 rok'],
          ['adonis-session', 'app.canvai.dev', 'Sesja logowania', 'do 2 godzin bezczynności'],
          ['XSRF-TOKEN', 'app.canvai.dev', 'Ochrona przed atakami CSRF', 'sesja'],
          ['dc_locale', 'app.canvai.dev', 'Wybrany język aplikacji', '1 rok'],
          ['dc_ref', 'app.canvai.dev', 'Kod polecający z linku', '30 dni'],
          ['_clck, _clsk, CLID, MUID', 'oba (tylko za zgodą)', 'Microsoft Clarity — analityka', 'od 1 dnia do 1 roku'],
        ],
      },
    },
    {
      id: 'okres',
      title: '8. Jak długo przechowujemy dane',
      list: [
        'Dane konta i treści — do czasu usunięcia konta; kopie zapasowe nadpisujemy w ciągu 30 dni.',
        'Materiały i wersje DESIGN.md — do czasu ich usunięcia przez Ciebie albo usunięcia konta.',
        'Dane rozliczeniowe — przez okres wymagany przepisami podatkowymi i rachunkowymi.',
        'Logi serwera — zwykle do 90 dni.',
        'Dane Clarity — zgodnie z ustawieniami Microsoft Clarity (do 13 miesięcy).',
      ],
    },
    {
      id: 'prawa',
      title: '9. Twoje prawa',
      body: [
        `Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia, a także prawo sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Zgodę możesz wycofać w dowolnym momencie — nie wpływa to na zgodność z prawem przetwarzania przed jej wycofaniem. Aby skorzystać z praw lub usunąć konto, napisz na ${LEGAL.email}.`,
        'Masz też prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).',
      ],
    },
    {
      id: 'wymogi',
      title: '10. Dobrowolność i wiek',
      body: [
        'Podanie danych jest dobrowolne, ale bez adresu e-mail i hasła nie założysz konta. Z usługi mogą korzystać osoby, które ukończyły 16 lat. Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby skutki prawne.',
      ],
    },
    {
      id: 'zmiany',
      title: '11. Zmiany polityki',
      body: [
        'O istotnych zmianach poinformujemy w aplikacji lub e-mailem. Aktualna wersja jest zawsze dostępna na tej stronie.',
      ],
    },
  ],
}

const en: PrivacyContent = {
  title: 'Privacy policy',
  metaDescription:
    'How canvai processes personal data, which cookies and analytics tools it uses, and what your rights are.',
  intro:
    'This policy explains how we process personal data on canvai.dev (the product website) and in the app at app.canvai.dev. We keep it plain and specific — if anything is unclear, write to us.',
  updatedLabel: 'Last updated',
  tocLabel: 'Contents',
  sections: [
    {
      id: 'controller',
      title: '1. Data controller',
      body: [
        `The controller of your personal data is ${LEGAL.controller}. For anything related to personal data, write to ${LEGAL.email}.`,
      ],
    },
    {
      id: 'data',
      title: '2. What data we process and why',
      table: {
        head: ['Data', 'Purpose', 'Legal basis'],
        rows: [
          [
            'Account: email, name (optional), password hash, preferred language',
            'Creating and running your account, sign-in, email verification, password reset',
            'Performance of a contract (Art. 6(1)(b) GDPR)',
          ],
          [
            'Content you add: boards, images, files, links, notes, generated DESIGN.md documents',
            'Providing the service: storing boards and generating specifications with AI',
            'Performance of a contract (Art. 6(1)(b))',
          ],
          [
            'Billing data: plan, credit balance and history, order and subscription IDs',
            'Charging credits and plans, handling payments and refunds',
            'Contract (b) and legal obligations (c)',
          ],
          [
            'Technical data: IP address, server logs, device and browser data',
            'Security, abuse prevention, troubleshooting',
            'Legitimate interest (f)',
          ],
          [
            'Microsoft Clarity analytics: clicks, scrolling, session recordings (form field contents excluded)',
            'Improving the website and the app',
            'Consent (a) — only once given',
          ],
          ['Referrals: who referred whom, bonuses granted', 'Referral programme', 'Performance of a contract (b)'],
        ],
      },
    },
    {
      id: 'ai',
      title: '3. AI processing',
      body: [
        'To generate DESIGN.md and UI previews, board materials (images, texts, notes, link metadata) are sent to our AI model provider — currently DeepSeek (Hangzhou DeepSeek Artificial Intelligence Co., Ltd., China). This means data leaves the European Economic Area for a country without a European Commission adequacy decision.',
        'Materials are sent only when you start a generation. Do not put personal data on boards that you do not want to share with the AI provider (e.g. screenshots containing customer data).',
      ],
    },
    {
      id: 'recipients',
      title: '4. Who processes data for us',
      body: ['We rely on trusted providers that process data on our behalf or as independent controllers:'],
      list: [
        'Contabo GmbH — app.canvai.dev server (data centre in France, EU).',
        'Cloudflare, Inc. — hosting and CDN for canvai.dev, DNS.',
        'DeepSeek — AI analysis of materials and content generation (see section 3).',
        'Transactional email provider (e.g. Resend) — sending account emails.',
        'Polar Software, Inc. (polar.sh) — seller and payment operator (Merchant of Record). Polar processes payment data and issues invoices on its own; we never see card numbers.',
        'Microsoft Corporation — Microsoft Clarity behaviour analytics (only with consent).',
      ],
    },
    {
      id: 'transfers',
      title: '5. Transfers outside the EEA',
      body: [
        'Cloudflare, Microsoft and Polar may process data in the United States under the EU-US Data Privacy Framework or standard contractual clauses. Transfers to DeepSeek (China) are described in section 3.',
      ],
    },
    {
      id: 'portal',
      title: '6. Client portal',
      body: [
        'canvai users can share a portal with their clients to upload materials and approve a DESIGN.md. Data submitted through the portal (name, files, links, comments) is processed on behalf of the user who shared the link — that user is the controller of this data.',
      ],
    },
    {
      id: 'cookies',
      title: '7. Cookies',
      body: [
        'Essential cookies are always set — sign-in and security do not work without them. Microsoft Clarity analytics cookies are set only after you consent. You can change or withdraw consent at any time via “Cookie settings” in the footer.',
      ],
      table: {
        head: ['Cookie', 'Site', 'Purpose', 'Lifetime'],
        rows: [
          ['canvai_consent', 'canvai.dev, app.canvai.dev', 'Remembers your cookie choice', '180 days'],
          ['canvai_lang', 'canvai.dev', 'Chosen website language', '1 year'],
          ['adonis-session', 'app.canvai.dev', 'Sign-in session', 'up to 2 hours of inactivity'],
          ['XSRF-TOKEN', 'app.canvai.dev', 'CSRF protection', 'session'],
          ['dc_locale', 'app.canvai.dev', 'Chosen app language', '1 year'],
          ['dc_ref', 'app.canvai.dev', 'Referral code from a link', '30 days'],
          ['_clck, _clsk, CLID, MUID', 'both (consent only)', 'Microsoft Clarity analytics', '1 day to 1 year'],
        ],
      },
    },
    {
      id: 'retention',
      title: '8. How long we keep data',
      list: [
        'Account data and content — until the account is deleted; backups are overwritten within 30 days.',
        'Materials and DESIGN.md versions — until you delete them or delete your account.',
        'Billing data — for as long as tax and accounting laws require.',
        'Server logs — usually up to 90 days.',
        'Clarity data — per Microsoft Clarity settings (up to 13 months).',
      ],
    },
    {
      id: 'rights',
      title: '9. Your rights',
      body: [
        `You have the right to access, rectify and erase your data, restrict processing, data portability, and to object to processing based on legitimate interest. You may withdraw consent at any time without affecting processing carried out before withdrawal. To exercise your rights or delete your account, write to ${LEGAL.email}.`,
        'You may also lodge a complaint with a supervisory authority — in Poland, the President of the Personal Data Protection Office (ul. Stawki 2, 00-193 Warsaw).',
      ],
    },
    {
      id: 'requirements',
      title: '10. Voluntary data and age',
      body: [
        'Providing data is voluntary, but you cannot create an account without an email and password. The service is for people aged 16 and over. We do not make decisions about you based solely on automated processing that produce legal effects.',
      ],
    },
    {
      id: 'changes',
      title: '11. Changes to this policy',
      body: ['We will announce material changes in the app or by email. The current version is always on this page.'],
    },
  ],
}

export const privacy: Record<Lang, PrivacyContent> = { pl, en }
