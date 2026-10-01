/**
 * Szablony tablic: ramki na typowe materiały (logo, ekrany, stany, inspiracje)
 * ze wskazówkami, co wrzucić, i strzałkami przepływu między ekranami.
 *
 * Wskazówki to elementy z `hint: true` — kontekst generacji DESIGN.md je
 * pomija (to instrukcja dla człowieka, nie informacja o produkcie). Etykiety
 * ramek zostają: nazwa ekranu pomaga AI opisać „Screens & Flows”.
 */
import type { Locale } from './i18n.js'
import type { SceneDocument, SceneElement } from './scene.js'

type Text = Record<Locale, string>

interface TemplateFrame {
  label: Text
  hint: Text
  /** Ramka ekranu bierze udział w przepływie (strzałki). */
  screen?: boolean
}

export interface BoardTemplate {
  id: string
  title: Text
  description: Text
  frames: TemplateFrame[]
}

const BRAND: TemplateFrame = {
  label: { pl: 'Logo i marka', en: 'Logo & brand' },
  hint: {
    pl: 'Wrzuć logo, księgę znaku albo kolory marki. Wpisz w notatce nazwę fontu, jeśli ją znasz.',
    en: 'Drop the logo, brand guidelines or brand colors. Note the font name if you know it.',
  },
}

const INSPIRATION: TemplateFrame = {
  label: { pl: 'Inspiracje', en: 'Inspiration' },
  hint: {
    pl: 'Zrzuty stron i aplikacji, które się podobają. W notatce przy obrazie napisz, CO konkretnie się podoba.',
    en: 'Screenshots of sites and apps you like. In the note next to each image, say WHAT exactly you like.',
  },
}

const STATES: TemplateFrame = {
  label: { pl: 'Stany: błąd, pusty, ładowanie', en: 'States: error, empty, loading' },
  hint: {
    pl: 'Formularz z błędem, pusta lista, komunikat sukcesu — dzięki nim DESIGN.md opisze stany zamiast je zgadywać.',
    en: 'A form with an error, an empty list, a success message — so DESIGN.md describes states instead of guessing.',
  },
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'landing',
    title: { pl: 'Strona internetowa / landing', en: 'Website / landing page' },
    description: {
      pl: 'Hero, sekcje, cennik i stopka — dla stron firmowych i produktowych.',
      en: 'Hero, sections, pricing and footer — for company and product sites.',
    },
    frames: [
      BRAND,
      {
        label: { pl: 'Hero (pierwszy ekran)', en: 'Hero (first screen)' },
        hint: {
          pl: 'Zrzut pierwszego ekranu obecnej strony albo wzoru: nagłówek, CTA, zdjęcie.',
          en: 'A screenshot of the first screen of the current site or a reference: headline, CTA, image.',
        },
        screen: true,
      },
      {
        label: {
          pl: 'Sekcje: oferta, opinie, cennik',
          en: 'Sections: features, testimonials, pricing',
        },
        hint: {
          pl: 'Zrzuty sekcji niżej na stronie — karty, siatki, cennik.',
          en: 'Screenshots of sections further down — cards, grids, pricing.',
        },
        screen: true,
      },
      {
        label: { pl: 'Kontakt i stopka', en: 'Contact & footer' },
        hint: {
          pl: 'Formularz kontaktowy, stopka, newsletter.',
          en: 'Contact form, footer, newsletter.',
        },
        screen: true,
      },
      INSPIRATION,
      {
        label: { pl: 'Ton komunikacji', en: 'Tone of voice' },
        hint: {
          pl: 'Wklej przykładowe teksty marki (nagłówki, przyciski) albo opisz, jak marka mówi.',
          en: 'Paste sample brand copy (headlines, buttons) or describe how the brand talks.',
        },
      },
    ],
  },
  {
    id: 'saas',
    title: { pl: 'Aplikacja SaaS / panel', en: 'SaaS app / dashboard' },
    description: {
      pl: 'Panel, tabele, formularze i ustawienia — dla aplikacji webowych.',
      en: 'Dashboard, tables, forms and settings — for web apps.',
    },
    frames: [
      BRAND,
      {
        label: { pl: 'Panel główny', en: 'Main dashboard' },
        hint: {
          pl: 'Zrzut głównego ekranu: nawigacja, karty z liczbami, wykresy.',
          en: 'Main screen: navigation, stat cards, charts.',
        },
        screen: true,
      },
      {
        label: { pl: 'Lista / tabela', en: 'List / table' },
        hint: {
          pl: 'Tabela danych z filtrami, paginacją i akcjami w wierszu.',
          en: 'Data table with filters, pagination and row actions.',
        },
        screen: true,
      },
      {
        label: { pl: 'Formularz / ustawienia', en: 'Form / settings' },
        hint: {
          pl: 'Formularz z polami, przełącznikami i przyciskami zapisu.',
          en: 'A form with fields, toggles and save buttons.',
        },
        screen: true,
      },
      STATES,
      INSPIRATION,
    ],
  },
  {
    id: 'ecommerce',
    title: { pl: 'Sklep internetowy', en: 'Online store' },
    description: {
      pl: 'Lista produktów, karta produktu, koszyk i checkout.',
      en: 'Product list, product page, cart and checkout.',
    },
    frames: [
      BRAND,
      {
        label: { pl: 'Lista produktów', en: 'Product list' },
        hint: {
          pl: 'Siatka produktów z filtrami i sortowaniem.',
          en: 'Product grid with filters and sorting.',
        },
        screen: true,
      },
      {
        label: { pl: 'Karta produktu', en: 'Product page' },
        hint: {
          pl: 'Galeria, cena, warianty, przycisk „Dodaj do koszyka”.',
          en: 'Gallery, price, variants, “Add to cart” button.',
        },
        screen: true,
      },
      {
        label: { pl: 'Koszyk i checkout', en: 'Cart & checkout' },
        hint: {
          pl: 'Koszyk, dane dostawy, płatność, potwierdzenie zamówienia.',
          en: 'Cart, shipping details, payment, order confirmation.',
        },
        screen: true,
      },
      STATES,
      INSPIRATION,
    ],
  },
  {
    id: 'mobile',
    title: { pl: 'Aplikacja mobilna', en: 'Mobile app' },
    description: {
      pl: 'Onboarding, ekran główny, szczegóły i nawigacja dolna.',
      en: 'Onboarding, home screen, details and bottom navigation.',
    },
    frames: [
      {
        label: { pl: 'Ikona i marka', en: 'App icon & brand' },
        hint: BRAND.hint,
      },
      {
        label: { pl: 'Onboarding / logowanie', en: 'Onboarding / sign in' },
        hint: {
          pl: 'Ekrany powitalne, logowanie, zgody.',
          en: 'Welcome screens, sign in, permissions.',
        },
        screen: true,
      },
      {
        label: { pl: 'Ekran główny', en: 'Home screen' },
        hint: {
          pl: 'Główny ekran z nawigacją dolną albo zakładkami.',
          en: 'Main screen with bottom navigation or tabs.',
        },
        screen: true,
      },
      {
        label: { pl: 'Szczegóły', en: 'Details' },
        hint: {
          pl: 'Ekran szczegółów elementu z akcjami.',
          en: 'Item detail screen with actions.',
        },
        screen: true,
      },
      STATES,
      INSPIRATION,
    ],
  },
]

/** Kamera startowa tablicy z szablonu: cały układ (3 kolumny × 2 rzędy) widoczny od razu. */
export const TEMPLATE_CAMERA = { x: 48, y: 120, scale: 0.38 }

const FRAME_W = 760
const FRAME_H = 520
const GAP_X = 160
const GAP_Y = 220
const COLUMNS = 3
const INK = '#27251e'
const GRAPHITE = '#72706b'
const FONT = "'Inter Variable', Inter, system-ui, sans-serif"

function id(): string {
  return globalThis.crypto.randomUUID()
}

/** Dokument sceny z szablonu (pusty dla nieznanego id). */
export function buildTemplateScene(templateId: string, locale: Locale): SceneDocument {
  const template = BOARD_TEMPLATES.find((t) => t.id === templateId)
  const elements: SceneElement[] = []
  if (!template) return { elements, metadata: {} } as unknown as SceneDocument

  const positions: { x: number; y: number }[] = []
  template.frames.forEach((frame, i) => {
    const x = (i % COLUMNS) * (FRAME_W + GAP_X)
    const y = Math.floor(i / COLUMNS) * (FRAME_H + GAP_Y)
    positions.push({ x, y })
    elements.push({
      id: id(),
      type: 'text',
      x,
      y: y - 70,
      rotation: 0,
      opacity: 1,
      text: frame.label[locale],
      fontSize: 44,
      fontFamily: FONT,
      fill: INK,
      label: true,
    } as unknown as SceneElement)
    elements.push({
      id: id(),
      type: 'rectangle',
      x,
      y,
      width: FRAME_W,
      height: FRAME_H,
      rotation: 0,
      opacity: 1,
      fill: 'transparent',
      stroke: GRAPHITE,
      strokeWidth: 2,
      cornerRadius: 16,
    } as SceneElement)
    elements.push({
      id: id(),
      type: 'sticky',
      x: x + 24,
      y: y + 24,
      width: 460,
      height: 260,
      rotation: 0,
      opacity: 0.9,
      text: frame.hint[locale],
      fill: '#efe7d8',
      fontSize: 26,
      hint: true,
    } as unknown as SceneElement)
  })

  // Strzałki przepływu między kolejnymi ekranami w tym samym rzędzie.
  const screens = template.frames.map((f, i) => (f.screen ? i : -1)).filter((i) => i >= 0)
  for (let k = 0; k + 1 < screens.length; k++) {
    const a = positions[screens[k]]
    const b = positions[screens[k + 1]]
    if (a.y !== b.y) continue
    const startX = a.x + FRAME_W + 16
    elements.push({
      id: id(),
      type: 'arrow',
      x: startX,
      y: a.y + FRAME_H / 2,
      rotation: 0,
      opacity: 1,
      points: [
        { x: 0, y: 0 },
        { x: b.x - startX - 16, y: 0 },
      ],
      stroke: INK,
      strokeWidth: 2,
    } as SceneElement)
  }

  return { elements, metadata: { template: template.id } } as unknown as SceneDocument
}
