/**
 * Typy i definicje narzędzi edytora płótna.
 *
 * Czysty moduł (bez Reacta/Konvy), współdzielony przez klienta (`@shared/tools`)
 * i serwer (testy unit, `#shared/tools`). To NIE jest część kontraktu
 * `SceneDocument` — to konfiguracja UI silnika.
 */
export type Tool =
  | 'select'
  | 'pan'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'text'
  | 'sticky'

export interface ToolDef {
  id: Tool
  label: string
  shortcut?: string
}

/** Definicje narzędzi paska. `data-testid` przycisku = `tool-${id}`. */
export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Zaznacz', shortcut: 'V' },
  { id: 'pan', label: 'Pan', shortcut: 'H' },
  { id: 'frame', label: 'Ramka (ekran)', shortcut: 'F' },
  { id: 'rectangle', label: 'Prostokąt', shortcut: 'R' },
  { id: 'ellipse', label: 'Elipsa', shortcut: 'O' },
  { id: 'line', label: 'Linia', shortcut: 'L' },
  { id: 'arrow', label: 'Strzałka', shortcut: 'A' },
  { id: 'freehand', label: 'Od ręki', shortcut: 'P' },
  { id: 'text', label: 'Tekst', shortcut: 'T' },
  { id: 'sticky', label: 'Notatka', shortcut: 'S' },
]

/** Narzędzia dostępne w trybie podglądu (bez edycji). */
export const VIEW_TOOLS: Tool[] = ['select', 'pan']

/** Narzędzie przypisane do klawisza (bez modyfikatorów), np. `r` → prostokąt. */
export function toolForKey(key: string): Tool | null {
  if (key.length !== 1) return null
  const upper = key.toUpperCase()
  return TOOLS.find((t) => t.shortcut === upper)?.id ?? null
}

export function toolTestId(id: Tool): string {
  return `tool-${id}`
}
