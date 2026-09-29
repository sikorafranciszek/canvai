/**
 * Paleta elementów płótna — ciepłe, stonowane kolory zgodne z design systemem
 * (pergamin + atrament). Teal zarezerwowany jest dla zaznaczenia i stanów
 * aktywnych edytora, dlatego nie ma go wśród domyślnych kolorów treści.
 */

export const INK = '#27251e'
export const GRAPHITE = '#72706b'
export const SELECTION = '#016a71'
export const SELECTION_TINT = 'rgba(1, 106, 113, 0.08)'

/** Kolory obrysu / tekstu / linii. */
export const STROKE_COLORS = [
  { value: '#27251e', label: 'Atrament' },
  { value: '#72706b', label: 'Grafit' },
  { value: '#b5562f', label: 'Terakota' },
  { value: '#b8862b', label: 'Ochra' },
  { value: '#557a55', label: 'Szałwia' },
  { value: '#3f6282', label: 'Łupek' },
  { value: '#7a4b6b', label: 'Śliwka' },
] as const

/** Wypełnienia kształtów (`transparent` = brak). */
export const FILL_COLORS = [
  { value: 'transparent', label: 'Brak' },
  { value: '#fdfbfa', label: 'Papier' },
  { value: '#efe7d8', label: 'Piasek' },
  { value: '#dcebe0', label: 'Mięta' },
  { value: '#dde8ef', label: 'Niebo' },
  { value: '#f3dfd8', label: 'Róż' },
  { value: '#e7e1ee', label: 'Lawenda' },
] as const

/** Kolory karteczek. */
export const STICKY_COLORS = [
  { value: '#f7e6a6', label: 'Żółta' },
  { value: '#efe7d8', label: 'Piaskowa' },
  { value: '#dcebe0', label: 'Miętowa' },
  { value: '#dde8ef', label: 'Niebieska' },
  { value: '#f3dfd8', label: 'Różowa' },
  { value: '#e7e1ee', label: 'Lawendowa' },
] as const

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
