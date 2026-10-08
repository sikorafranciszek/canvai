import sanitizeHtml from 'sanitize-html'
import type { DesignSpec, SpecColor } from '#services/design/spec'

/**
 * Deterministyczny podgląd UI ze specyfikacji: nawigacja, hero, karty
 * komponentów, formularz, paleta i skala typografii — wszystko na tokenach
 * z DESIGN.md. Używany przez dostawcę `mock` i jako szkielet w promptach.
 */

function esc(value: string): string {
  // Odnośniki do materiałów ([A12]) i znaczniki założeń (†) są dla AI, nie dla strony.
  return value
    .replace(/\s*\[A\d+\]/g, '')
    .replace(/†/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pick(colors: SpecColor[], patterns: RegExp[], fallback: string): string {
  for (const pattern of patterns) {
    const hit = colors.find((c) => pattern.test(`${c.token} ${c.name} ${c.role}`))
    if (hit) return hit.hex
  }
  return fallback
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function onColor(hex: string): string {
  return luminance(hex) > 0.45 ? '#111111' : '#ffffff'
}

function firstValue(items: { name: string; value: string }[], pattern: RegExp, fallback: string) {
  return items.find((i) => pattern.test(i.name))?.value ?? items[0]?.value ?? fallback
}

/** Link do Google Fonts dla rodzin ze specyfikacji (nieznane nazwy są nieszkodliwe). */
export function googleFontsHref(spec: DesignSpec): string | null {
  const names = [...new Set(spec.typography.families.map((f) => f.name.trim()))].filter((n) =>
    /^[A-Za-z0-9 ]{2,40}$/.test(n)
  )
  if (!names.length) return null
  const families = names.map((n) => `family=${n.replace(/ /g, '+')}:wght@400;500;600;700`)
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}

export function renderPreviewTemplate(spec: DesignSpec): string {
  const c = spec.colors
  const bg = pick(c, [/canvas|background|page/i, /surface/i], '#fafafa')
  const surface = pick(c, [/surface|card|paper/i], '#ffffff')
  const ink = pick(
    c,
    [/ink|text|foreground|primary text/i],
    luminance(bg) > 0.4 ? '#111111' : '#f5f5f5'
  )
  const muted = pick(c, [/muted|secondary|graphite|subtle/i], ink)
  const border = pick(c, [/border|hairline|divider|line/i], 'rgba(0,0,0,0.12)')
  const accent = pick(c, [/accent|brand|action|cta|primary(?! text)/i], ink)

  const heading = spec.typography.families[0]?.name ?? 'system-ui'
  const body = spec.typography.families[1]?.name ?? heading
  const radiusButton = firstValue(spec.radii, /button|control/i, '8px')
  const radiusCard = firstValue(spec.radii, /card|container|panel/i, '12px')
  const shadow = firstValue(spec.shadows, /card|subtle|base/i, 'none')
  const fonts = googleFontsHref(spec)

  const nav = (spec.screens.length ? spec.screens : [{ name: 'Home' }, { name: 'About' }])
    .slice(0, 4)
    .map((s) => `<a href="#">${esc(s.name)}</a>`)
    .join('')
  const cards = (
    spec.components.length
      ? spec.components
      : [{ name: 'Card', description: spec.overview, states: [] as string[] }]
  )
    .slice(0, 6)
    .map(
      (comp) => `<article class="card">
        <h3>${esc(comp.name)}</h3>
        <p>${esc(comp.description).slice(0, 180)}</p>
        ${
          comp.states.length
            ? `<div class="chips">${comp.states
                .slice(0, 4)
                .map((st) => `<span>${esc(st)}</span>`)
                .join('')}</div>`
            : ''
        }
      </article>`
    )
    .join('\n')
  const swatches = c
    .slice(0, 10)
    .map(
      (col) =>
        `<div class="swatch"><span style="background:${esc(col.hex)};color:${onColor(col.hex)}">${esc(col.hex)}</span><b>${esc(col.name)}</b></div>`
    )
    .join('')
  const scale = spec.typography.scale
    .slice(0, 5)
    .map(
      (r) =>
        `<div class="scale"><span style="font-size:${esc(r.size)};font-weight:${esc(r.weight)};line-height:${esc(r.lineHeight === '—' ? '1.3' : r.lineHeight)}">${esc(r.role)}</span><small>${esc(r.size)} · ${esc(r.weight)}</small></div>`
    )
    .join('')
  const lead = spec.overview.split(/(?<=\.)\s/)[0] ?? ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.name)} — UI preview</title>
${fonts ? `<link rel="stylesheet" href="${esc(fonts)}">` : ''}
<style>
:root{--bg:${bg};--surface:${surface};--ink:${ink};--muted:${muted};--border:${border};--accent:${accent};--on-accent:${onColor(accent)};--r-btn:${radiusButton};--r-card:${radiusCard};--shadow:${shadow}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:'${esc(body)}',system-ui,sans-serif;line-height:1.55}
h1,h2,h3{font-family:'${esc(heading)}',system-ui,sans-serif;line-height:1.15;letter-spacing:-0.01em}
a{color:inherit;text-decoration:none}
.wrap{width:min(1120px,100% - 40px);margin:0 auto}
header{border-bottom:1px solid var(--border);background:var(--surface)}
header .wrap{display:flex;align-items:center;gap:28px;height:64px}
.logo{font-weight:700;font-family:'${esc(heading)}',system-ui,sans-serif}
nav{display:flex;gap:20px;font-size:14px;color:var(--muted)}
header .btn{margin-left:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;height:42px;padding:0 18px;border-radius:var(--r-btn);font-weight:600;font-size:15px;border:1px solid transparent}
.btn-primary{background:var(--accent);color:var(--on-accent)}
.btn-ghost{border-color:var(--border);color:var(--ink);background:transparent}
.hero{padding:88px 0 64px}
.hero h1{font-size:clamp(34px,5vw,58px);max-width:780px}
.hero p{margin-top:18px;max-width:620px;font-size:18px;color:var(--muted)}
.hero .actions{display:flex;gap:10px;margin-top:28px;flex-wrap:wrap}
section{padding:56px 0}
section h2{font-size:28px;margin-bottom:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);padding:22px;box-shadow:var(--shadow)}
.card h3{font-size:18px;margin-bottom:8px}
.card p{color:var(--muted);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.chips span{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
form{display:grid;gap:12px}
label{font-size:13px;font-weight:600}
input,textarea{width:100%;font:inherit;padding:11px 14px;border-radius:var(--r-btn);border:1px solid var(--border);background:var(--bg);color:var(--ink)}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.swatch{display:flex;flex-direction:column;gap:6px;font-size:13px}
.swatch span{display:flex;align-items:flex-end;height:72px;padding:8px;border-radius:var(--r-card);border:1px solid var(--border);font-family:ui-monospace,monospace;font-size:12px}
.scale{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border)}
.scale small{color:var(--muted);white-space:nowrap}
footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:14px}
@media (max-width:760px){nav{display:none}.split{grid-template-columns:1fr}.hero{padding:56px 0 40px}}
</style>
</head>
<body>
<header><div class="wrap"><span class="logo">${esc(spec.name)}</span><nav>${nav}</nav><a class="btn btn-primary" href="#">Get started</a></div></header>
<main>
<div class="wrap hero">
<h1>${esc(spec.tagline || spec.name)}</h1>
<p>${esc(lead)}</p>
<div class="actions"><a class="btn btn-primary" href="#">Primary action</a><a class="btn btn-ghost" href="#">Secondary</a></div>
</div>
<section><div class="wrap"><h2>Components</h2><div class="grid">${cards}</div></div></section>
<section><div class="wrap split">
<div class="card"><h2 style="font-size:22px;margin-bottom:16px">Contact</h2><form onsubmit="return false"><label>Name<input placeholder="Jane Doe"></label><label>Message<textarea rows="3" placeholder="Tell us about your project"></textarea></label><button class="btn btn-primary" type="button">Send message</button></form></div>
<div><h2 style="font-size:22px">Typography</h2>${scale}</div>
</div></section>
<section><div class="wrap"><h2>Palette</h2><div class="swatches">${swatches}</div></div></section>
</main>
<footer><div class="wrap">${esc(spec.name)} · UI preview generated from DESIGN.md</div></footer>
</body>
</html>`
}

/** CSP osadzony w pliku — chroni także pobrany podgląd otwarty z dysku (bez nagłówków). */
export const PREVIEW_META_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'symbol',
  'text',
  'tspan',
]
const SVG_ATTRS = [
  'viewbox',
  'xmlns',
  'fill',
  'fill-rule',
  'fill-opacity',
  'clip-rule',
  'clip-path',
  'mask',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'points',
  'width',
  'height',
  'transform',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'preserveaspectratio',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-weight',
  'font-family',
  'patternunits',
  'focusable',
  'aria-hidden',
]

const GOOGLE_FONTS = 'fonts.googleapis.com'

/** Tylko arkusz Google Fonts po HTTPS — dokładny host, nie „fonts.googleapis.com.evil.test”. */
function isGoogleFontsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === GOOGLE_FONTS
  } catch {
    return false
  }
}

/**
 * CSS bez zewnętrznych zasobów: `@import` tylko Google Fonts, `url(…)` tylko
 * `data:` (obrazy i fonty osadzone), bez `expression()` i `-moz-binding`.
 */
export function sanitizeCss(css: string): string {
  return (
    css
      // Znaczniki w CSS nie mają sensu — usuwamy, by nic nie udawało HTML-a.
      .replace(/<[^>]*>?/g, '')
      .replace(
        /@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?[^;]*;?/gi,
        (rule, href: string) => (isGoogleFontsUrl(href) ? rule : '')
      )
      .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (match, _q, href: string) =>
        /^data:(?:image|font)\//i.test(href.trim()) ? match : 'none'
      )
      .replace(/expression\s*\(|-moz-binding|behavior\s*:/gi, '')
  )
}

/**
 * Oczyszczenie HTML z modelu parserem (SEC-11): lista dozwolonych elementów
 * i atrybutów, bez skryptów, obsługi zdarzeń, ramek i zewnętrznych zasobów
 * (poza arkuszem Google Fonts). Plik dostaje własny meta CSP — pobrany podgląd
 * otwarty z dysku też niczego nie wykona. Druga linia obrony przy serwowaniu
 * to nagłówki CSP i sandbox (kontroler podglądu).
 */
export function sanitizePreviewHtml(html: string): string {
  const body = sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'html',
      'head',
      'body',
      'title',
      'meta',
      'link',
      'style',
      'img',
      'picture',
      'figure',
      'figcaption',
      'header',
      'footer',
      'main',
      'nav',
      'section',
      'article',
      'aside',
      'form',
      'label',
      'input',
      'textarea',
      'select',
      'option',
      'button',
      'fieldset',
      'legend',
      'details',
      'summary',
      'progress',
      'meter',
      'time',
      'mark',
      'small',
      'sup',
      'sub',
      ...SVG_TAGS,
    ],
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': [
        'class',
        'id',
        'style',
        'role',
        'title',
        'lang',
        'dir',
        'hidden',
        'tabindex',
        'aria-*',
        'data-*',
        ...SVG_ATTRS,
      ],
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height', 'loading'],
      'meta': ['charset', 'name', 'content'],
      'link': ['rel', 'href', 'crossorigin'],
      'input': [
        'type',
        'placeholder',
        'value',
        'name',
        'checked',
        'disabled',
        'readonly',
        'min',
        'max',
        'step',
      ],
      'textarea': ['placeholder', 'rows', 'name', 'disabled', 'readonly'],
      'button': ['type', 'disabled'],
      'option': ['value', 'selected'],
      'select': ['name', 'disabled'],
      'label': ['for'],
      'progress': ['value', 'max'],
      'meter': ['value', 'min', 'max'],
      'time': ['datetime'],
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data'], link: ['https'] },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => {
      if (frame.tag === 'link') {
        return frame.attribs.rel !== 'stylesheet' || !isGoogleFontsUrl(frame.attribs.href ?? '')
      }
      // Tylko <meta charset> i <meta name=…> (viewport, opis) — bez http-equiv/refresh.
      if (frame.tag === 'meta') return !frame.attribs.charset && !frame.attribs.name
      return false
    },
  })
  // Blok <style> i atrybut style: bez zewnętrznych zasobów (parser zostawia CSS bez zmian).
  const styled = body
    .replace(
      /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_m, open: string, css: string, close: string) => `${open}${sanitizeCss(css)}${close}`
    )
    .replace(/\sstyle="([^"]*)"/gi, (_m, css: string) => ` style="${sanitizeCss(css)}"`)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_META_CSP}">`
  const withCsp = /<head[^>]*>/i.test(styled)
    ? styled.replace(/<head[^>]*>/i, (head) => `${head}${meta}`)
    : `<head>${meta}</head>${styled}`
  return `<!doctype html>\n${withCsp.replace(/^\s*<!doctype[^>]*>\s*/i, '')}`
}

/**
 * Twarde nagłówki podglądu: bez skryptów (CSP `sandbox` bez `allow-scripts`),
 * jedyne zewnętrzne zasoby to Google Fonts, osadzanie tylko w aplikacji.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox',
].join('; ')

/** Nagłówki odpowiedzi z HTML podglądu (aplikacja i portal klienta). */
export function previewHeaders(response: { header: (name: string, value: string) => unknown }) {
  response.header('Content-Type', 'text/html; charset=utf-8')
  response.header('Content-Security-Policy', PREVIEW_CSP)
  response.header('X-Content-Type-Options', 'nosniff')
  response.header('Referrer-Policy', 'no-referrer')
  // Globalny X-Frame-Options (Shield) blokowałby iframe w samej aplikacji.
  response.header('X-Frame-Options', 'SAMEORIGIN')
  response.header('Cache-Control', 'private, no-store')
}
