import type { MessageKey } from '~/i18n'
/**
 * Paleta elementów płótna — ciepłe, stonowane kolory zgodne z design systemem
 * (pergamin + atrament). Teal zarezerwowany jest dla zaznaczenia i stanów
 * aktywnych edytora, dlatego nie ma go wśród domyślnych kolorów treści.
 */

export const INK = '#27251e'
export const GRAPHITE = '#72706b'
export const SELECTION = '#016a71'
export const SELECTION_TINT = 'rgba(1, 106, 113, 0.08)'

/** Kolory obrysu / tekstu / linii. `label` = klucz słownika UI. */
export const STROKE_COLORS = [
  { value: '#27251e', label: 'color.ink' },
  { value: '#72706b', label: 'color.graphite' },
  { value: '#b5562f', label: 'color.terracotta' },
  { value: '#b8862b', label: 'color.ochre' },
  { value: '#557a55', label: 'color.sage' },
  { value: '#3f6282', label: 'color.slate' },
  { value: '#7a4b6b', label: 'color.plum' },
] as const satisfies readonly { value: string; label: MessageKey }[]

/** Wypełnienia kształtów (`transparent` = brak). */
export const FILL_COLORS = [
  { value: 'transparent', label: 'color.none' },
  { value: '#fdfbfa', label: 'color.paper' },
  { value: '#efe7d8', label: 'color.sand' },
  { value: '#dcebe0', label: 'color.mint' },
  { value: '#dde8ef', label: 'color.sky' },
  { value: '#f3dfd8', label: 'color.rose' },
  { value: '#e7e1ee', label: 'color.lavender' },
] as const satisfies readonly { value: string; label: MessageKey }[]

/** Kolory karteczek. */
export const STICKY_COLORS = [
  { value: '#f7e6a6', label: 'color.yellow' },
  { value: '#efe7d8', label: 'color.sand' },
  { value: '#dcebe0', label: 'color.mint' },
  { value: '#dde8ef', label: 'color.sky' },
  { value: '#f3dfd8', label: 'color.rose' },
  { value: '#e7e1ee', label: 'color.lavender' },
] as const satisfies readonly { value: string; label: MessageKey }[]

export const DEFAULTS = {
  shapeFill: '#fdfbfa',
  shapeStroke: INK,
  line: GRAPHITE,
  arrow: INK,
  freehand: INK,
  text: INK,
  sticky: '#f7e6a6',
  linkCard: '#dde8ef',
} as const

export const FONT_FAMILY = "'Inter Variable', Inter, system-ui, sans-serif"
