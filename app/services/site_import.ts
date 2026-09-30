import { safeFetch } from '#services/safe_fetch'

/**
 * Import strony z adresu URL — bez przeglądarki na serwerze: pobieramy HTML
 * i arkusze CSS (bezpiecznie, z limitami), a z nich wyciągamy to, co mówi
 * o stylu: kolory (z częstością i nazwami zmiennych CSS), fonty, nagłówki,
 * theme-color, obraz og:image i ikonę.
 */

export interface SiteStyle {
  url: string
  host: string
  title: string | null
  description: string | null
  themeColor: string | null
  colors: { hex: string; count: number; variable: string | null }[]
  fonts: string[]
  headings: string[]
  ogImage: string | null
  icon: string | null
}

const GENERIC_FONTS = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
  'emoji',
  'math',
  'var',
  'segoe ui',
  'roboto',
  'helvetica neue',
  'arial',
  'helvetica',
  'noto sans',
  'apple color emoji',
  'segoe ui emoji',
  'segoe ui symbol',
  'noto color emoji',
  'liberation sans',
  'menlo',
  'monaco',
  'consolas',
  'courier new',
])

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null
}

function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase()
    if (k === key) return attr(tag, 'content')
  }
  return null
}

function toHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** Normalizuje kolor CSS do #rrggbb (pomija przezroczyste i nieczytelne). */
export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase()
  const hex = v.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && Number.parseInt(h[3], 16) < 8) return null
      h = h
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('')
    } else if (h.length === 8) {
      if (Number.parseInt(h.slice(6, 8), 16) < 128) return null
      h = h.slice(0, 6)
    } else if (h.length !== 6) return null
    return `#${h}`
  }
  const rgb = v.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/
  )
  if (rgb) {
    const alpha = rgb[4]
      ? rgb[4].endsWith('%')
        ? Number.parseFloat(rgb[4]) / 100
        : Number.parseFloat(rgb[4])
      : 1
    if (alpha < 0.5) return null
    return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
  }
  return null
}

function distance(a: string, b: string): number {
  const pa = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16))
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
}

/** Kolory z CSS: częstość, scalanie bliskich odcieni, nazwy zmiennych. */
export function extractColors(css: string, limit = 12): SiteStyle['colors'] {
  const counts = new Map<string, number>()
  const variables = new Map<string, string>()

  for (const m of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    const hex = normalizeColor(m[2])
    if (hex && !variables.has(hex)) variables.set(hex, `--${m[1]}`)
  }
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const hex = normalizeColor(m[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }

  const merged: SiteStyle['colors'] = []
  for (const [hex, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const near = merged.find((c) => distance(c.hex, hex) < 18)
    if (near) near.count += count
    else merged.push({ hex, count, variable: variables.get(hex) ?? null })
  }
  return merged.sort((a, b) => b.count - a.count).slice(0, limit)
}

/** Fonty z `font-family` i linków Google Fonts (bez rodzin systemowych). */
export function extractFonts(css: string, html: string, limit = 4): string[] {
  const counts = new Map<string, number>()
  const add = (name: string, weight = 1) => {
    const clean = name
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim()
    if (
      !clean ||
      clean.length > 40 ||
      GENERIC_FONTS.has(clean.toLowerCase()) ||
      clean.startsWith('var(')
    )
      return
    counts.set(clean, (counts.get(clean) ?? 0) + weight)
  }
  // @font-face — strony z fontami ładowanymi przez zmienne CSS (np. next/font).
  for (const block of css.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const fam = block[1].match(/font-family\s*:\s*([^;]+)/i)
    if (fam) add(fam[1].trim().replace(/\s+Fallback(['"]?)$/i, '$1'), 2)
  }
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) add(m[1].split(',')[0])
  for (const m of css.matchAll(/--[\w-]*font[\w-]*\s*:\s*([^;}{]+)/gi)) add(m[1].split(',')[0])
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) {
    for (const fam of decodeEntities(m[1]).matchAll(/family=([^&:]+)/g))
      add(decodeURIComponent(fam[1].replace(/\+/g, ' ')), 5)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name)
}

export async function analyzeSite(rawUrl: string): Promise<SiteStyle> {
  const page = await safeFetch(rawUrl, { timeoutMs: 6000, maxBytes: 2 * 1024 * 1024 })
  if (page.status < 200 || page.status >= 300 || !page.contentType.includes('html')) {
    throw new Error(`HTTP ${page.status}`)
  }
  const html = page.text()
  const base = new URL(page.url)
  const abs = (href: string | null) => {
    if (!href) return null
    try {
      const u = new URL(href, base)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  }

  // CSS: <style>, atrybuty style="" i do 6 arkuszy <link rel=stylesheet>.
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
  const styleAttrs = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1])
  const sheetUrls = (html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => /rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag))
    .map((tag) => abs(attr(tag, 'href')))
    .filter((u): u is string => Boolean(u) && !/fonts\.googleapis\.com/.test(u!))
    .slice(0, 6)
  const sheets = await Promise.all(
    sheetUrls.map((u) =>
      safeFetch(u, { timeoutMs: 4000, maxBytes: 800 * 1024 })
        .then((r) => (r.status >= 200 && r.status < 300 ? r.text() : ''))
        .catch(() => '')
    )
  )
  const css = [...inline, ...styleAttrs, ...sheets].join('\n')

  const links = html.match(/<link\b[^>]*>/gi) ?? []
  const iconTag =
    links.find((tag) => /rel\s*=\s*["']?apple-touch-icon/i.test(tag)) ??
    links.find((tag) => /rel\s*=\s*["']?(shortcut )?icon/i.test(tag))

  const headings = [
    ...new Set(
      [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map((m) => stripTags(m[2]))
        .filter((h) => h.length > 1 && h.length <= 140)
    ),
  ].slice(0, 6)

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return {
    url: page.url,
    host: base.hostname.replace(/^www\./, ''),
    title: (titleTag ? stripTags(titleTag) : meta(html, 'og:title'))?.slice(0, 160) || null,
    description: (meta(html, 'description') ?? meta(html, 'og:description'))?.slice(0, 300) || null,
    themeColor: normalizeColor(meta(html, 'theme-color') ?? ''),
    colors: extractColors(css),
    fonts: extractFonts(css, html),
    headings,
    ogImage: abs(meta(html, 'og:image') ?? meta(html, 'twitter:image')),
    icon: abs(iconTag ? attr(iconTag, 'href') : null),
  }
}

/** Notatka stylu strony dla AI (po angielsku, jak pozostałe dane dla modelu). */
export function siteStyleNote(style: SiteStyle): string {
  const lines = [`WEBSITE REFERENCE — ${style.host}${style.title ? ` (“${style.title}”)` : ''}`]
  if (style.description) lines.push(`About: ${style.description}`)
  if (style.themeColor) lines.push(`Theme color: ${style.themeColor}`)
  if (style.colors.length) {
    lines.push(
      `Colors used in CSS (most frequent first): ${style.colors
        .slice(0, 10)
        .map((c) => (c.variable ? `${c.hex} ${c.variable}` : c.hex))
        .join(', ')}`
    )
  }
  if (style.fonts.length) lines.push(`Fonts: ${style.fonts.join(', ')}`)
  if (style.headings.length)
    lines.push(`Headlines: ${style.headings.map((h) => `“${h}”`).join(' · ')}`)
  return lines.join('\n')
}
