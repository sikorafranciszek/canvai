/**
 * `SceneDocument` — kontrakt modelu sceny (wersja 1).
 *
 * JEDNO źródło prawdy. Importowany i przez serwer (`#shared/scene`),
 * i przez klienta (`@shared/scene`). NIE kopiować tej definicji do `app/`
 * ani `inertia/` — obie strony importują ten sam moduł.
 *
 * Zasady kontraktu (uzgodnione z bramką BLA-10 i BLA-6 / Romusiem):
 * - `version` (optimistic lock) NIE należy do dokumentu. Żyje w kolumnie
 *   `board_scenes.version` i w kopercie requestu/odpowiedzi
 *   `PUT /api/boards/:id/scene`.
 * - Kamera (zoom/pan) NIE należy do dokumentu. Żyje w `board_scenes.app_state`.
 * - Element `image` niesie TYLKO `assetId` + geometrię. Żadnego base64, data URL
 *   ani zapiekanego URL-a — binaria żyją po stronie serwera (tabela `assets`).
 * - Nieznane typy elementów oraz nieznane pola muszą przejść przez zapis bez
 *   utraty (backend waliduje kopertę i regułę `image`, ale nie obcina pól).
 * - Dokument musi się bezstratnie serializować: `JSON.parse(JSON.stringify(doc))`
 *   daje identyczny dokument. Wszystkie pola są JSON-safe (number/string/boolean/
 *   array/object/null) — bez `undefined`, `Date`, `Map`, `Set` itp.
 */

/** Typy elementów obsługiwane przez silnik płótna (M2a). */
export type SceneElementType =
  'rectangle' | 'ellipse' | 'line' | 'arrow' | 'freehand' | 'text' | 'sticky' | 'image'

/** Lista typów elementów — do walidacji i paska narzędzi. */
export const SCENE_ELEMENT_TYPES: readonly SceneElementType[] = [
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'freehand',
  'text',
  'sticky',
  'image',
] as const

/** Punkt w przestrzeni sceny. */
export interface ScenePoint {
  x: number
  y: number
}

/** Wspólne pola każdego elementu sceny. */
export interface SceneElementBase {
  /** Stabilny identyfikator elementu (UUID v4), generowany po stronie klienta. */
  id: string
  type: SceneElementType
  /** Pozycja elementu w przestrzeni sceny. */
  x: number
  y: number
  /** Obrót w stopniach, zgodnie z ruchem wskazówek zegara, wokół środka elementu. */
  rotation: number
  /** Krycie 0..1 (1 = nieprzezroczysty). */
  opacity: number
}

/** Wspólne pola kształtów zamkniętych (prostokąt, elipsa, sticky). */
export interface SceneShapeBase extends SceneElementBase {
  width: number
  height: number
}

export interface SceneRectangleElement extends SceneShapeBase {
  type: 'rectangle'
  fill: string
  stroke: string
  strokeWidth: number
  /** Zaokrąglenie rogów w px. Brak = ostre rogi. */
  cornerRadius?: number
  /**
   * Ramka ekranu (FEAT-7): nazwa wyświetlana nad prostokątem. AI traktuje nazwane
   * ramki jako ekrany (Screens & Flows), a elementy w środku — jako ich treść.
   */
  frameName?: string
}

export interface SceneEllipseElement extends SceneShapeBase {
  type: 'ellipse'
  fill: string
  stroke: string
  strokeWidth: number
}

export interface SceneStickyElement extends SceneShapeBase {
  type: 'sticky'
  text: string
  fill: string
  fontSize?: number
  /**
   * Opcjonalna referencja do assetu (karta linku). Dla elementów `image`
   * `assetId` jest wymagane — dla sticky jest opcjonalne i używane wyłącznie
   * do powiązania karty linku z wpisem assetu w panelu bocznym.
   */
  assetId?: string
}

/** Elementy liniowe: punkty w układzie LOKALNYM elementu (względem x/y). */
export interface SceneLineElement extends SceneElementBase {
  type: 'line'
  points: ScenePoint[]
  stroke: string
  strokeWidth: number
}

export interface SceneArrowElement extends SceneElementBase {
  type: 'arrow'
  points: ScenePoint[]
  stroke: string
  strokeWidth: number
  /** Rozmiar grotu strzałki w px. */
  arrowHeadSize?: number
}

export interface SceneFreehandElement extends SceneElementBase {
  type: 'freehand'
  points: ScenePoint[]
  stroke: string
  strokeWidth: number
}

export interface SceneTextElement extends SceneElementBase {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  fill: string
  /** Szerokość łamania tekstu. Brak = brak łamania (auto-size). */
  width?: number
  align?: 'left' | 'center' | 'right'
}

/**
 * Element obrazu — wyłącznie referencja do assetu + geometria.
 * URL do renderowania rozwiązywany jest z `assetId` po stronie klienta
 * (przez API assetów, patrz BLA-9). Binariów NIE trzymamy w scenie.
 */
export interface SceneImageElement extends SceneElementBase {
  type: 'image'
  /** Referencja do assetu po stronie serwera (tabela `assets`). */
  assetId: string
  width: number
  height: number
}

export type SceneElement =
  | SceneRectangleElement
  | SceneEllipseElement
  | SceneLineElement
  | SceneArrowElement
  | SceneFreehandElement
  | SceneTextElement
  | SceneStickyElement
  | SceneImageElement

/**
 * Metadane dokumentu sceny. Otwarte na rozszerzenia — nieznane pola muszą
 * przejść przez zapis bez utraty.
 */
export interface SceneMetadata {
  name?: string
  [key: string]: unknown
}

/**
 * Dokument sceny = lista elementów + metadane.
 *
 * Kolejność elementów w tablicy wyznacza kolejność warstw (z-order):
 * indeks 0 = spód, ostatni indeks = wierzch.
 *
 * Celowo NIE zawiera `version` (optimistic lock) ani kamery (zoom/pan) —
 * te żyją odpowiednio w kolumnach `board_scenes.version` i `board_scenes.app_state`.
 */
export interface SceneDocument {
  elements: SceneElement[]
  metadata: SceneMetadata
}

/** Pusty dokument sceny — punkt startowy dla nowych tablic i store'a. */
export function emptySceneDocument(): SceneDocument {
  return {
    elements: [],
    metadata: {},
  }
}
