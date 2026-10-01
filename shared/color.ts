/**
 * Matematyka kolorów wspólna dla serwera i przeglądarki: OKLab/OKLCH, kontrast
 * WCAG 2.x i dobór najbliższego odcienia, który spełnia wymagany kontrast.
 */

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as Rgb
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToOklab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab → sRGB (liniowo nieprzycięte; `null`, gdy poza gamutem). */
function oklabToRgb([L, a, b]: Rgb): Rgb | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear) as Rgb
  return rgb.every((v) => v >= -0.0005 && v <= 1.0005) ? rgb : null
}

/** Odległość percepcyjna (OKLab, euklidesowa; ~0.02 = ledwo widoczna różnica). */
export function colorDistance(a: string, b: string): number {
  const [x, y] = [hexToOklab(a), hexToOklab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Kontrast WCAG 2.x (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

/**
 * Najbliższy odcień `fg` (ta sama barwa, zmieniona jasność; chroma redukowana,
 * gdy wychodzi poza sRGB), który ma z `bg` kontrast co najmniej `target`.
 * `null`, gdy się nie da (wtedy pozostaje czerń albo biel).
 */
export function fixContrast(fg: string, bg: string, target = 4.5): string | null {
  if (contrastRatio(fg, bg) >= target) return fg
  const [L, a, b] = hexToOklab(fg)
  const darker = relativeLuminance(bg) > 0.18
  const candidate = (l: number): string | null => {
    for (let k = 1; k >= 0; k -= 0.05) {
      const rgb = oklabToRgb([l, a * k, b * k])
      if (rgb) return rgbToHex(rgb)
    }
    return null
  }
  // Wyszukiwanie binarne jasności między obecną a skrajną (0 albo 1).
  let lo = L
  let hi = darker ? 0 : 1
  let best: string | null = null
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const hex = candidate(mid)
    if (hex && contrastRatio(hex, bg) >= target) {
      best = hex
      hi = mid
    } else {
      lo = mid
    }
  }
  if (best) return best
  const extreme = darker ? '#000000' : '#ffffff'
  return contrastRatio(extreme, bg) >= target ? extreme : null
}
