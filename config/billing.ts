import env from '#start/env'

/**
 * Rozliczenia: plany, limity, cennik kredytów i Lemon Squeezy.
 *
 * Model: klient płaci KREDYTAMI (nie surowymi tokenami) — stała, przewidywalna
 * cena za akcję. Kredyty żyją w pulach (`credit_grants`) z datą ważności;
 * zużycie zdejmuje najpierw pule wygasające najwcześniej.
 *
 * Generacja: kredyty są rezerwowane przy zleceniu (szacunek), rozliczane po
 * sukcesie (faktycznie przeanalizowane materiały) i w całości zwracane po błędzie.
 */

export type PlanId = 'free' | 'payg' | 'pro' | 'team'

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
}

const PAID: PlanLimits = {
  boards: null,
  materialsPerBoard: 40,
  versionsKept: null,
  watermark: false,
  exports: true,
  proReasoning: true,
  api: true,
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
  },
  payg: PAID,
  pro: PAID,
  team: { ...PAID, materialsPerBoard: 80 },
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

export type ProductId = 'pack_s' | 'pack_m' | 'pack_l' | 'pro' | 'team'

export interface Product {
  id: ProductId
  kind: 'pack' | 'subscription'
  credits: number
  /** Cena do wyświetlenia — źródłem prawdy jest produkt w Lemon Squeezy. */
  price: string
  /** Wariant produktu w Lemon Squeezy; brak = produkt niedostępny w sprzedaży. */
  variantId: string | null
  /** Plan nadawany przez subskrypcję. */
  plan?: PlanId
  /** Ważność kredytów w miesiącach (subskrypcja: 2 = rollover o jeden miesiąc). */
  validMonths: number
}

const variant = (key: string) => env.get(key as any) || null

export const products: Record<ProductId, Product> = {
  pack_s: {
    id: 'pack_s',
    kind: 'pack',
    credits: 100,
    price: '$9',
    variantId: variant('LEMONSQUEEZY_VARIANT_PACK_S'),
    validMonths: 12,
  },
  pack_m: {
    id: 'pack_m',
    kind: 'pack',
    credits: 300,
    price: '$24',
    variantId: variant('LEMONSQUEEZY_VARIANT_PACK_M'),
    validMonths: 12,
  },
  pack_l: {
    id: 'pack_l',
    kind: 'pack',
    credits: 1000,
    price: '$69',
    variantId: variant('LEMONSQUEEZY_VARIANT_PACK_L'),
    validMonths: 12,
  },
  pro: {
    id: 'pro',
    kind: 'subscription',
    credits: 300,
    price: '$19',
    variantId: variant('LEMONSQUEEZY_VARIANT_PRO'),
    plan: 'pro',
    validMonths: 2,
  },
  // Team: wspólna pula i miejsca dla zespołu — jeszcze niezbudowane, więc bez wariantu.
  team: {
    id: 'team',
    kind: 'subscription',
    credits: 1200,
    price: '$59',
    variantId: null,
    plan: 'team',
    validMonths: 2,
  },
}

export const lemonSqueezy = {
  apiKey: env.get('LEMONSQUEEZY_API_KEY') || null,
  storeId: env.get('LEMONSQUEEZY_STORE_ID') || null,
  webhookSecret: env.get('LEMONSQUEEZY_WEBHOOK_SECRET') || null,
  apiUrl: 'https://api.lemonsqueezy.com/v1',
  /** Checkout w trybie testowym (sklep w test mode). */
  testMode: env.get('LEMONSQUEEZY_TEST_MODE', false),
}

/** Czy sprzedaż jest skonfigurowana (klucz API + sklep). */
export function checkoutReady(): boolean {
  return Boolean(lemonSqueezy.apiKey && lemonSqueezy.storeId)
}

/**
 * Czy limity planów i kredyty są egzekwowane. Mutowalne — testy niezwiązane
 * z rozliczeniami działają bez limitów (`BILLING_ENFORCED=false` w .env.test).
 */
export const billing = {
  enforced: env.get('BILLING_ENFORCED', true),
}
