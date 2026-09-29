# canvai.dev — strona produktu

Statyczna strona produktowa canvai (Astro 7), dwujęzyczna (EN pod `/`, PL pod
`/pl/`), serwowana przez **Cloudflare Workers** pod `canvai.dev` i
`www.canvai.dev`. Aplikacja działa osobno pod **`app.canvai.dev`** — przyciski
„Log in / Get started” prowadzą do `https://app.canvai.dev/login|signup?lang=…`
(aplikacja otwiera się w tym samym języku).

## Uruchomienie

```bash
cd landing
npm install
npm run dev        # http://localhost:4321 (Astro dev)
npm run build      # → ./dist
npm run preview    # wrangler dev — podgląd z Workerem (przekierowania języka)
```

## Wdrożenie (Cloudflare Workers)

Wymagania: domena `canvai.dev` dodana jako strefa w koncie Cloudflare.

```bash
cd landing
npx wrangler login     # jednorazowo, w interaktywnym terminalu
npm run deploy         # astro build && wrangler deploy
```

W CI zamiast `wrangler login` ustaw `CLOUDFLARE_API_TOKEN` (uprawnienia:
Workers Scripts: Edit, Workers Routes: Edit, Zone: DNS Edit dla canvai.dev) i
`CLOUDFLARE_ACCOUNT_ID`. `wrangler.jsonc` podpina Worker jako **Custom Domain**
dla `canvai.dev` i `www.canvai.dev` — rekordy DNS i certyfikaty Cloudflare
tworzy sam.

## Worker (`worker/index.ts`)

Działa przed plikami statycznymi:

- `www.canvai.dev` → `canvai.dev` (301),
- wejście na `/`: zapamiętany wybór (cookie `canvai_lang`, ustawiany przez
  przełącznik PL/EN) albo język przeglądarki — polski → `/pl/`, inny → EN,
- nagłówki bezpieczeństwa (HSTS, nosniff, X-Frame-Options, Referrer-Policy).

## Treści

Wszystkie teksty obu wersji są w `src/i18n/content.ts`. Sekcja cennika czyta
`pricing.plans` — dziś dostępny jest tylko „Early access” (za darmo), plany
„Individual” i „Team” mają status `soon` (bez cen). Żeby ogłosić cennik,
uzupełnij `price`, `priceNote`, `features` i zmień `status` na `available`.

## Zrzuty produktu

`public/screens/hero-{en,pl}.{webp,png}` i `public/og-{en,pl}.png` powstają z
prawdziwej aplikacji. Aby je odświeżyć, uruchom aplikację na porcie 4000
(`PORT=4000 node ace serve --hmr` w katalogu głównym) i:

```bash
node landing/scripts/capture-screens.mjs
```

Skrypt zakłada konta demo, buduje tablicę z makiet w `scripts/demo-assets/`,
generuje DESIGN.md i robi zrzuty w obu językach.
