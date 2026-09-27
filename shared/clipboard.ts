/**
 * Schowek elementów sceny — serializacja do i z SYSTEMOWEGO schowka.
 *
 * Dlaczego przez schowek systemowy, a nie zmienną w pamięci modułu:
 * `Ctrl+V` musi zadziałać dla zrzutu ekranu (kryterium akceptacji v1 nr 2),
 * więc płótno słucha zdarzenia `paste`, a nie `keydown`. Zdarzenie `paste`
 * dostaje wyłącznie zawartość schowka systemowego, dlatego kopiowanie
 * elementów też musi tam trafić — inaczej `paste` i `keydown` konkurowałyby
 * o ten sam skrót i wklejenie obrazka duplikowałoby jednocześnie elementy
 * z nieaktualnego schowka w pamięci.
 *
 * Ładunek to zwykły tekst z prefiksem-sentinelem, więc wklejenie do edytora
 * tekstu jest nieszkodliwe, a kopiowanie działa też między kartami aplikacji.
 */
import { SCENE_ELEMENT_TYPES, type SceneElement } from './scene.js'

/** Prefiks rozpoznający ładunek tego płótna w schowku systemowym. */
export const CLIPBOARD_SENTINEL = 'design-canvas/elements:'

/** Przesunięcie wklejanej kopii, żeby nie zakrywała oryginału 1:1. */
export const PASTE_OFFSET = 20

/** Serializuje elementy do tekstu, który trafia do schowka systemowego. */
export function serializeElements(elements: SceneElement[]): string {
  return CLIPBOARD_SENTINEL + JSON.stringify(elements)
}

/**
 * Odwrotność `serializeElements`. Zwraca `null` dla każdego tekstu, który nie
 * jest naszym ładunkiem — wtedy wywołujący traktuje wklejenie jak URL/notatkę.
 *
 * Zawartość schowka jest danymi z zewnątrz (użytkownik mógł ją ręcznie
 * zmodyfikować), więc kształt jest walidowany, a nie zakładany.
 */
export function parseClipboardElements(text: string | null | undefined): SceneElement[] | null {
  if (!text || !text.startsWith(CLIPBOARD_SENTINEL)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(CLIPBOARD_SENTINEL.length))
  } catch {
    return null
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null
  if (!parsed.every(isSceneElementLike)) return null

  return parsed as SceneElement[]
}

/**
 * Przygotowuje wklejane elementy: nowe identyfikatory (kopia nie może dzielić
 * `id` z oryginałem ani z inną kopią) i przesunięcie o `PASTE_OFFSET`.
 *
 * `newId` wstrzykiwane, bo `crypto.randomUUID()` wymaga bezpiecznego kontekstu,
 * a test musi być deterministyczny.
 */
export function prepareElementsForPaste(
  elements: SceneElement[],
  newId: () => string,
  offset = PASTE_OFFSET
): SceneElement[] {
  return elements.map(
    (el) => ({ ...el, id: newId(), x: el.x + offset, y: el.y + offset }) as SceneElement
  )
}

function isSceneElementLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const el = value as Record<string, unknown>
  return (
    typeof el.id === 'string' &&
    typeof el.type === 'string' &&
    SCENE_ELEMENT_TYPES.includes(el.type as SceneElement['type']) &&
    Number.isFinite(el.x) &&
    Number.isFinite(el.y)
  )
}
