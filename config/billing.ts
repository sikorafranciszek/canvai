import env from '#start/env'

/**
 * Rozliczenia: plany, limity, cennik kredytów i Polar.sh (Merchant of Record).
 *
 * Model: klient płaci KREDYTAMI (nie surowymi tokenami) — stała, przewidywalna
 * cena za akcję. Kredyty żyją w pulach (`credit_grants`) z datą ważności;
 * zużycie zdejmuje najpierw pule wygasające najwcześniej.
 *
 * Generacja: kredyty są rezerwowane przy zleceniu (szacunek), rozliczane po
 * sukcesie (faktycznie przeanalizowane materiały) i w całości zwracane po błędzie.
 */

export type PlanId = 'free' | 'payg' | 'pro' | 'team' | 'agency'

export interface PlanLimits {
  /** Maksymalna liczba tablic; `null` = bez limitu. */
  boards: number | null
  /** Maksymalna liczba materiałów (assetów) na tablicy. */
  materialsPerBoard: number
  /** Ile ostatnich wersji DESIGN.md jest dostępnych; `null` = wszystkie. */
  versionsKept: number | null
  /** Stopka „Generated with canvai” w DESIGN.md. */
  watermark: boolean
  /** Eksport tokenów (CSS, Tailwind, JSON). */
  exports: boolean
  /** Tryb „Pro reasoning” (model rozumuje dłużej, ×2 kredyty). */
  proReasoning: boolean
  /** API (REST v1) i serwer MCP dla Cursora / Claude Code. */
  api: boolean
  /** Portal klienta: link do przesyłania materiałów i akceptacji DESIGN.md. */
  portal: boolean
  /** Brand kity: kolory, fonty i zasady marki do ponownego użycia. */
  brandKits: boolean
  /** Ilu współpracowników (edytorów i podglądających) można zaprosić do tablicy. */
  collaborators: number
  /** White-label: własna marka w portalu klienta, PDF i DESIGN.md, bez wzmianek o canvai. */
  whiteLabel: boolean
}

const PAID: PlanLimits = {
  boards: null,
  materialsPerBoard: 40,
  versionsKept: null,
  watermark: false,
  exports: true,
  proReasoning: true,
  api: true,
  portal: true,
  brandKits: true,
  collaborators: 3,
  whiteLabel: false,
}

export const plans: Record<PlanId, PlanLimits> = {
  free: {
    boards: 1,
    materialsPerBoard: 10,
    versionsKept: 2,
    watermark: true,
    exports: false,
    proReasoning: false,
    api: false,
    portal: false,
    brandKits: false,
    collaborators: 0,
    whiteLabel: false,
  },
  payg: PAID,
  pro: { ...PAID, collaborators: 5 },
  team: { ...PAID, materialsPerBoard: 80, collaborators: 50 },
  agency: { ...PAID, materialsPerBoard: 120, collaborators: 50, whiteLabel: true },
}

/** Cennik akcji w kredytach. */
export const costs = {
  /** Analiza nowego / zmienionego materiału (z cache — 0). */
  perMaterial: 1,
  /** Złożenie dokumentu DESIGN.md. */
  compose: 4,
  /** Mnożnik trybu Pro reasoning. */
  proMultiplier: 2,
  /** Podgląd UI — przykładowa strona HTML z DESIGN.md. */
  preview: 6,
  /** Poprawka poleceniem / regeneracja sekcji (FEAT-2) — bez nowych analiz. */
  revision: 2,
}

/** Darmowe kredyty. */
export const freeCredits = {
  /** Jednorazowo na start (ważne 12 miesięcy). */
  signup: 30,
  /** Co miesiąc w planie Free (nie kumulują się — wygasają z końcem miesiąca). */
  monthly: 10,
}

/** Polecenia: obie strony dostają kredyty, gdy polecony potwierdzi e-mail. */
export const referrals = {
  reward: 50,
  /** Ile nagród może zebrać jeden polecający (ochrona przed nadużyciami). */
  maxPerReferrer: 25,
  validMonths: 12,
  cookie: 'dc_ref',
}

export type ProductId = 'pack_s' | 'pack_m' | 'pack_l' | 'pro' | 'team' | 'agency'

export interface Product {
  id: ProductId
  kind: 'pack' | 'subscription'
  credits: number
  /** Cena do wyświetlenia — źródłem prawdy jest produkt w Polar. */
  price: string
  /** ID produktu w Polar; brak = produkt niedostępny w sprzedaży. */
  polarProductId: string | null
  /** Plan nadawany przez subskrypcję. */
  plan?: PlanId
  /** Ważność kredytów w miesiącach (subskrypcja: 2 = rollover o jeden miesiąc). */
  validMonths: number
}

const polarProduct = (key: string) => env.get(key as any) || null

export const products: Record<ProductId, Product> = {
  pack_s: {
    id: 'pack_s',
    kind: 'pack',
    credits: 100,
    price: '$9',
    polarProductId: polarProduct('POLAR_PRODUCT_PACK_S'),
    validMonths: 12,
  },
  pack_m: {
    id: 'pack_m',
    kind: 'pack',
    credits: 300,
    price: '$24',
    polarProductId: polarProduct('POLAR_PRODUCT_PACK_M'),
    validMonths: 12,
  },
  pack_l: {
    id: 'pack_l',
    kind: 'pack',
    credits: 1000,
    price: '$69',
    polarProductId: polarProduct('POLAR_PRODUCT_PACK_L'),
    validMonths: 12,
  },
  pro: {
    id: 'pro',
    kind: 'subscription',
    credits: 300,
    price: '$19',
    polarProductId: polarProduct('POLAR_PRODUCT_PRO'),
    plan: 'pro',
    validMonths: 2,
  },
  // Team: współpracownicy na tablicach właściciela korzystają z jego puli kredytów.
  team: {
    id: 'team',
    kind: 'subscription',
    credits: 1200,
    price: '$59',
    polarProductId: polarProduct('POLAR_PRODUCT_TEAM'),
    plan: 'team',
    validMonths: 2,
  },
  // Agency: white-label (własna marka w portalu klienta, PDF i DESIGN.md) + duża pula.
  agency: {
    id: 'agency',
    kind: 'subscription',
    credits: 3000,
    price: '$149',
    polarProductId: polarProduct('POLAR_PRODUCT_AGENCY'),
    plan: 'agency',
    validMonths: 2,
  },
}

const polarServer = env.get('POLAR_SERVER', 'production')

export const polar = {
  accessToken: env.get('POLAR_ACCESS_TOKEN') || null,
  webhookSecret: env.get('POLAR_WEBHOOK_SECRET') || null,
  /** `sandbox` = sandbox.polar.sh (testowe płatności), `production` = polar.sh. */
  server: polarServer,
  apiUrl: polarServer === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh',
}

/** Czy sprzedaż jest skonfigurowana (token organizacji Polar). */
export function checkoutReady(): boolean {
  return Boolean(polar.accessToken)
}

/**
 * Czy limity planów i kredyty są egzekwowane. Mutowalne — testy niezwiązane
 * z rozliczeniami działają bez limitów (`BILLING_ENFORCED=false` w .env.test).
 */
export const billing = {
  enforced: env.get('BILLING_ENFORCED', true),
}
