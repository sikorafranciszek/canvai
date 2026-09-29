/**
 * Treści canvai.dev (EN/PL). Jedno źródło prawdy dla obu wersji językowych —
 * komponenty dostają obiekt dla bieżącego języka.
 *
 * Plany cenowe: `plans` — na razie tylko early access jest dostępny, pozostałe
 * mają status `soon` (bez cen). Gdy model sprzedaży będzie gotowy, wystarczy
 * uzupełnić `price` / `features` / `status` tutaj.
 */

export const APP_URL = 'https://app.canvai.dev'
export const SITE_URL = 'https://canvai.dev'

export type Lang = 'en' | 'pl'

export interface Plan {
  id: string
  name: string
  status: 'available' | 'soon'
  price: string
  priceNote: string
  description: string
  features: string[]
  cta: string
  highlighted?: boolean
}

const en = {
  lang: 'en' as Lang,
  meta: {
    title: 'canvai — turn client inspiration into a DESIGN.md your AI can build from',
    description:
      'canvai is an infinite canvas for screenshots, logos, links and notes. Arrange client materials and generate a grounded DESIGN.md — colors, typography, components and flows — ready for AI UI builders.',
  },
  nav: {
    features: 'Features',
    how: 'How it works',
    doc: 'DESIGN.md',
    pricing: 'Pricing',
    faq: 'FAQ',
    login: 'Log in',
    signup: 'Get started',
    menu: 'Menu',
    language: 'Language',
  },
  hero: {
    eyebrow: 'AI design specs from client materials',
    title: 'Turn client inspiration into a DESIGN.md your AI can build from',
    subtitle:
      'canvai is an infinite canvas for screenshots, logos, links and notes. Arrange them, add context, and generate a grounded design specification — colors, type, components and flows — ready for v0, Lovable, Cursor or Claude.',
    primary: 'Start for free',
    secondary: 'Log in',
    note: 'Free during early access · No credit card',
    imageAlt: 'canvai editor: client screenshots on an infinite canvas next to the generated DESIGN.md',
  },
  problem: {
    eyebrow: 'The problem',
    title: 'Design briefs arrive as a pile of screenshots',
    items: [
      {
        title: 'Scattered materials',
        text: 'Screenshots in chat, a logo in email, a link to “something like this”. Context lives in people’s heads.',
      },
      {
        title: 'AI builders guess the style',
        text: 'Without a precise spec, AI UI tools invent colors, spacing and components — and every screen drifts.',
      },
      {
        title: 'Specs take hours',
        text: 'Writing tokens, components and flows by hand is slow, and it goes stale the moment the brief changes.',
      },
    ],
    solution:
      'canvai collects everything in one place and turns it into a single, grounded source of truth for the interface.',
  },
  how: {
    eyebrow: 'How it works',
    title: 'From moodboard to spec in three steps',
    steps: [
      {
        title: 'Collect',
        text: 'Paste screenshots with Ctrl+V, drop files, add links and notes. PNG, JPG, WEBP, GIF, SVG and PDF.',
      },
      {
        title: 'Arrange',
        text: 'Group screens with frames, show the user flow with arrows and describe each material in a short note.',
      },
      {
        title: 'Generate',
        text: 'AI analyses every material and the board layout, then writes DESIGN.md with tokens, components and sources.',
      },
    ],
  },
  features: {
    eyebrow: 'Features',
    title: 'Everything the brief needs, nothing it doesn’t',
    items: [
      {
        icon: 'canvas',
        title: 'Infinite canvas',
        text: 'Shapes, arrows, frames, sticky notes and text — an Excalidraw-like board built for design briefs.',
      },
      {
        icon: 'paste',
        title: 'Paste anything',
        text: 'Screenshots from the clipboard, drag & drop, multi-file upload and link cards with page metadata.',
      },
      {
        icon: 'grounded',
        title: 'Grounded in your materials',
        text: 'Every color, font and component cites the asset it came from. Assumptions are marked and listed as open questions.',
      },
      {
        icon: 'tokens',
        title: 'Tokens to code',
        text: 'Ready-to-paste CSS custom properties and a Tailwind v4 theme, generated from the same tokens as the tables.',
      },
      {
        icon: 'flows',
        title: 'Screens & flows',
        text: 'Arrows and frames on the board become screens and user flows in the spec — layout is part of the signal.',
      },
      {
        icon: 'versions',
        title: 'Versions & diff',
        text: 'Regenerate when the brief changes, compare versions line by line and download the Markdown file.',
      },
      {
        icon: 'lang',
        title: 'Polish & English',
        text: 'The whole app, emails and messages in both languages — switch any time.',
      },
      {
        icon: 'lock',
        title: 'Private by default',
        text: 'Boards and files are visible only to their owner. Accounts are protected with email verification.',
      },
    ],
  },
  doc: {
    eyebrow: 'The output',
    title: 'A DESIGN.md written for machines — readable by people',
    text:
      'One Markdown file your UI-building AI can follow step by step: color and type tokens, spacing and shapes, components with states, screens and flows, do’s and don’ts, agent prompts and a Quick Start in CSS and Tailwind.',
    points: [
      'Style Reference format: tokens, components, do’s and don’ts',
      'Sources for every claim — [A12] points to the asset on the board',
      'Quick Start: :root variables and Tailwind v4 @theme',
      'Open questions instead of invented details',
    ],
  },
  audience: {
    eyebrow: 'Built for',
    title: 'Teams that ship interfaces with AI',
    items: [
      {
        title: 'Agencies & freelancers',
        text: 'Turn a client’s moodboard into a spec you can hand to AI tools — and to the client for sign-off.',
      },
      {
        title: 'Product teams',
        text: 'Keep a living design reference next to the materials it came from, versioned and easy to update.',
      },
      {
        title: 'AI-first builders',
        text: 'Feed v0, Lovable, Cursor or Claude a precise spec instead of a vague prompt — and get consistent screens.',
      },
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'Free while in early access',
    subtitle: 'We are shaping plans together with the first users. Everything available today is free.',
    soonBadge: 'Coming soon',
    availableBadge: 'Available now',
    plans: [
      {
        id: 'early-access',
        name: 'Early access',
        status: 'available',
        price: 'Free',
        priceNote: 'during early access',
        description: 'Full access to canvai while we build it with you.',
        features: [
          'Unlimited boards',
          'Paste, drop and upload materials',
          'DESIGN.md generation with versions and diff',
          'CSS & Tailwind Quick Start',
          'Polish and English',
        ],
        cta: 'Start for free',
        highlighted: true,
      },
      {
        id: 'individual',
        name: 'Individual',
        status: 'soon',
        price: '—',
        priceNote: 'pricing to be announced',
        description: 'For freelancers and solo builders working on many client projects.',
        features: [],
        cta: 'Coming soon',
      },
      {
        id: 'team',
        name: 'Team',
        status: 'soon',
        price: '—',
        priceNote: 'pricing to be announced',
        description: 'For agencies and product teams sharing boards and specs.',
        features: [],
        cta: 'Coming soon',
      },
    ] satisfies Plan[],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions, answered',
    items: [
      {
        q: 'What is DESIGN.md?',
        a: 'A Markdown design specification: tokens (colors, type, spacing), components with states, screens and flows, rules and ready-to-paste CSS. It is the single source of truth an AI (or a developer) follows to build a consistent UI.',
      },
      {
        q: 'Which AI tools can use it?',
        a: 'Any tool that accepts text context — v0, Lovable, Bolt, Cursor, Claude, ChatGPT and others. Paste the file or add it to the project.',
      },
      {
        q: 'What materials can I add?',
        a: 'Screenshots from the clipboard, PNG, JPG, WEBP, GIF, SVG and PDF files, links to reference websites and your own notes. Arrows and frames on the board are used as context too.',
      },
      {
        q: 'Does the AI invent things?',
        a: 'Every token and component cites the material it comes from. When something is not shown — for example the exact font — canvai proposes a sensible default, marks it as an assumption and lists it under open questions.',
      },
      {
        q: 'Are my materials private?',
        a: 'Yes. Boards and files are visible only to their owner and are never published.',
      },
      {
        q: 'How much does it cost?',
        a: 'canvai is free during early access. Paid plans will be announced before anything changes.',
      },
    ],
  },
  cta: {
    title: 'Give your AI a brief it can actually follow',
    text: 'Create a board, paste the client’s materials and generate your first DESIGN.md in minutes.',
    primary: 'Get started for free',
    secondary: 'Log in',
  },
  footer: {
    tagline: 'Client materials in, build-ready DESIGN.md out.',
    product: 'Product',
    account: 'Account',
    rights: 'All rights reserved.',
  },
  notFound: {
    title: 'Page not found',
    text: 'The page you are looking for does not exist.',
    back: 'Back to home',
  },
}

export type Content = typeof en

const pl: Content = {
  lang: 'pl',
  meta: {
    title: 'canvai — zamień inspiracje klienta w DESIGN.md, z którego zbuduje AI',
    description:
      'canvai to nieskończone płótno na zrzuty ekranów, logo, linki i notatki. Ułóż materiały klienta i wygeneruj ugruntowany DESIGN.md — kolory, typografię, komponenty i przepływy — gotowy dla AI budującego UI.',
  },
  nav: {
    features: 'Funkcje',
    how: 'Jak to działa',
    doc: 'DESIGN.md',
    pricing: 'Cennik',
    faq: 'FAQ',
    login: 'Zaloguj się',
    signup: 'Załóż konto',
    menu: 'Menu',
    language: 'Język',
  },
  hero: {
    eyebrow: 'Specyfikacja designu z materiałów klienta',
    title: 'Zamień inspiracje klienta w DESIGN.md, z którego zbuduje AI',
    subtitle:
      'canvai to nieskończone płótno na zrzuty ekranów, logo, linki i notatki. Ułóż je, dodaj kontekst i wygeneruj ugruntowaną specyfikację designu — kolory, typografię, komponenty i przepływy — gotową dla v0, Lovable, Cursora czy Claude.',
    primary: 'Zacznij za darmo',
    secondary: 'Zaloguj się',
    note: 'Bezpłatnie we wczesnym dostępie · Bez karty',
    imageAlt: 'Edytor canvai: zrzuty ekranów klienta na nieskończonym płótnie obok wygenerowanego DESIGN.md',
  },
  problem: {
    eyebrow: 'Problem',
    title: 'Brief designu przychodzi jako stos zrzutów ekranu',
    items: [
      {
        title: 'Materiały w rozsypce',
        text: 'Zrzuty na czacie, logo w mailu, link do „czegoś w tym stylu”. Kontekst zostaje w głowach.',
      },
      {
        title: 'AI zgaduje styl',
        text: 'Bez precyzyjnej specyfikacji narzędzia AI wymyślają kolory, odstępy i komponenty — każdy ekran wychodzi inaczej.',
      },
      {
        title: 'Specyfikacja to godziny pracy',
        text: 'Ręczne spisywanie tokenów, komponentów i przepływów trwa, a przy każdej zmianie briefu się dezaktualizuje.',
      },
    ],
    solution:
      'canvai zbiera wszystko w jednym miejscu i zamienia w jedno, ugruntowane źródło prawdy o interfejsie.',
  },
  how: {
    eyebrow: 'Jak to działa',
    title: 'Od moodboardu do specyfikacji w trzech krokach',
    steps: [
      {
        title: 'Zbierz',
        text: 'Wklej zrzuty przez Ctrl+V, upuść pliki, dodaj linki i notatki. PNG, JPG, WEBP, GIF, SVG i PDF.',
      },
      {
        title: 'Ułóż',
        text: 'Pogrupuj ekrany ramkami, pokaż przepływ strzałkami i opisz każdy materiał krótką notatką.',
      },
      {
        title: 'Wygeneruj',
        text: 'AI analizuje każdy materiał i układ tablicy, a potem pisze DESIGN.md z tokenami, komponentami i źródłami.',
      },
    ],
  },
  features: {
    eyebrow: 'Funkcje',
    title: 'Wszystko, czego potrzebuje brief — nic ponad to',
    items: [
      {
        icon: 'canvas',
        title: 'Nieskończone płótno',
        text: 'Kształty, strzałki, ramki, karteczki i tekst — tablica w stylu Excalidraw stworzona pod briefy designu.',
      },
      {
        icon: 'paste',
        title: 'Wklej cokolwiek',
        text: 'Zrzuty ze schowka, przeciąganie plików, upload wielu plików naraz i karty linków z opisem strony.',
      },
      {
        icon: 'grounded',
        title: 'Oparte na Twoich materiałach',
        text: 'Każdy kolor, font i komponent wskazuje materiał, z którego pochodzi. Założenia są oznaczone i trafiają do otwartych pytań.',
      },
      {
        icon: 'tokens',
        title: 'Tokeny prosto do kodu',
        text: 'Gotowe zmienne CSS i motyw Tailwind v4, generowane z tych samych tokenów co tabele.',
      },
      {
        icon: 'flows',
        title: 'Ekrany i przepływy',
        text: 'Strzałki i ramki z tablicy stają się ekranami i ścieżkami użytkownika w specyfikacji — układ też jest informacją.',
      },
      {
        icon: 'versions',
        title: 'Wersje i porównania',
        text: 'Generuj ponownie po zmianie briefu, porównuj wersje linia po linii i pobieraj plik Markdown.',
      },
      {
        icon: 'lang',
        title: 'Polski i angielski',
        text: 'Cała aplikacja, maile i komunikaty w obu językach — zmienisz w każdej chwili.',
      },
      {
        icon: 'lock',
        title: 'Prywatne domyślnie',
        text: 'Tablice i pliki widzi tylko ich właściciel. Konta chroni weryfikacja adresu e-mail.',
      },
    ],
  },
  doc: {
    eyebrow: 'Efekt',
    title: 'DESIGN.md pisany dla maszyn — czytelny dla ludzi',
    text:
      'Jeden plik Markdown, który AI budujące UI wykona krok po kroku: tokeny kolorów i typografii, odstępy i kształty, komponenty ze stanami, ekrany i przepływy, zasady do i don’t, prompty dla agentów oraz Quick Start w CSS i Tailwind.',
    points: [
      'Format Style Reference: tokeny, komponenty, do’s & don’ts',
      'Źródło każdego twierdzenia — [A12] wskazuje materiał na tablicy',
      'Quick Start: zmienne :root i @theme dla Tailwind v4',
      'Otwarte pytania zamiast wymyślonych szczegółów',
    ],
  },
  audience: {
    eyebrow: 'Dla kogo',
    title: 'Dla zespołów, które budują interfejsy z AI',
    items: [
      {
        title: 'Agencje i freelancerzy',
        text: 'Zamień moodboard klienta w specyfikację, którą przekażesz narzędziom AI — i klientowi do akceptacji.',
      },
      {
        title: 'Zespoły produktowe',
        text: 'Trzymaj żywą referencję designu obok materiałów, z których powstała — z wersjami i łatwą aktualizacją.',
      },
      {
        title: 'Budujący z AI',
        text: 'Daj v0, Lovable, Cursorowi czy Claude precyzyjną specyfikację zamiast ogólnego promptu — i spójne ekrany.',
      },
    ],
  },
  pricing: {
    eyebrow: 'Cennik',
    title: 'Za darmo we wczesnym dostępie',
    subtitle: 'Plany tworzymy razem z pierwszymi użytkownikami. Wszystko, co jest dostępne dziś, jest bezpłatne.',
    soonBadge: 'Wkrótce',
    availableBadge: 'Dostępne teraz',
    plans: [
      {
        id: 'early-access',
        name: 'Wczesny dostęp',
        status: 'available',
        price: '0 zł',
        priceNote: 'we wczesnym dostępie',
        description: 'Pełny dostęp do canvai, który rozwijamy razem z Tobą.',
        features: [
          'Nielimitowane tablice',
          'Wklejanie, przeciąganie i upload materiałów',
          'Generowanie DESIGN.md z wersjami i porównaniem',
          'Quick Start w CSS i Tailwind',
          'Polski i angielski',
        ],
        cta: 'Zacznij za darmo',
        highlighted: true,
      },
      {
        id: 'individual',
        name: 'Indywidualny',
        status: 'soon',
        price: '—',
        priceNote: 'cena wkrótce',
        description: 'Dla freelancerów i osób prowadzących wiele projektów klientów.',
        features: [],
        cta: 'Wkrótce',
      },
      {
        id: 'team',
        name: 'Zespół',
        status: 'soon',
        price: '—',
        priceNote: 'cena wkrótce',
        description: 'Dla agencji i zespołów produktowych, które współdzielą tablice i specyfikacje.',
        features: [],
        cta: 'Wkrótce',
      },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Najczęstsze pytania',
    items: [
      {
        q: 'Czym jest DESIGN.md?',
        a: 'To specyfikacja designu w Markdown: tokeny (kolory, typografia, odstępy), komponenty ze stanami, ekrany i przepływy, zasady oraz gotowy CSS. Jedno źródło prawdy, według którego AI (albo programista) zbuduje spójny interfejs.',
      },
      {
        q: 'Z jakimi narzędziami AI działa?',
        a: 'Z każdym, które przyjmuje kontekst tekstowy — v0, Lovable, Bolt, Cursor, Claude, ChatGPT i innymi. Wklej plik albo dodaj go do projektu.',
      },
      {
        q: 'Jakie materiały mogę dodać?',
        a: 'Zrzuty ze schowka, pliki PNG, JPG, WEBP, GIF, SVG i PDF, linki do stron referencyjnych i własne notatki. Strzałki i ramki na tablicy też są brane pod uwagę.',
      },
      {
        q: 'Czy AI coś wymyśla?',
        a: 'Każdy token i komponent wskazuje materiał, z którego pochodzi. Gdy czegoś nie widać — np. dokładnego fontu — canvai proponuje rozsądną wartość, oznacza ją jako założenie i dopisuje do otwartych pytań.',
      },
      {
        q: 'Czy moje materiały są prywatne?',
        a: 'Tak. Tablice i pliki widzi tylko ich właściciel i nigdy nie są publikowane.',
      },
      {
        q: 'Ile to kosztuje?',
        a: 'We wczesnym dostępie canvai jest bezpłatne. O planach płatnych poinformujemy, zanim cokolwiek się zmieni.',
      },
    ],
  },
  cta: {
    title: 'Daj AI brief, który naprawdę da się wykonać',
    text: 'Załóż tablicę, wklej materiały klienta i wygeneruj pierwszy DESIGN.md w kilka minut.',
    primary: 'Załóż konto za darmo',
    secondary: 'Zaloguj się',
  },
  footer: {
    tagline: 'Materiały klienta na wejściu, gotowy DESIGN.md na wyjściu.',
    product: 'Produkt',
    account: 'Konto',
    rights: 'Wszelkie prawa zastrzeżone.',
  },
  notFound: {
    title: 'Nie znaleziono strony',
    text: 'Strona, której szukasz, nie istnieje.',
    back: 'Wróć na stronę główną',
  },
}

export const content: Record<Lang, Content> = { en, pl }

export function homePath(lang: Lang): string {
  return lang === 'pl' ? '/pl/' : '/'
}

/** Linki do aplikacji przekazują język (`?lang=`), żeby app.canvai.dev otworzyła się w tym samym. */
export function appLink(path: '/login' | '/signup', lang: Lang): string {
  return `${APP_URL}${path}?lang=${lang}`
}
