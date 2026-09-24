import type { SceneElement } from '@shared/scene'

/**
 * Rozwiązuje URL do renderowania elementu `image` z `assetId`.
 *
 * Kontrakt mówi: w dokumencie NIE ma URL-a, tylko `assetId`. BLA-9 podepnie
 * realny endpoint assetów; na czas M2a wystarczy, że obraz renderuje się
 * z tego adresu (albo pokaże placeholder, gdy asset nie istnieje).
 */
export function resolveAssetUrl(assetId: string): string {
  return `/api/assets/${assetId}/content`
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Ramka (bounding box) elementu — do „dopasuj do zawartości" i zaznaczania. */
export function getElementBounds(el: SceneElement): Bounds {
  switch (el.type) {
    case 'line':
    case 'arrow':
    case 'freehand': {
      const xs = el.points.map((p) => p.x)
      const ys = el.points.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const maxX = Math.max(...xs)
      const maxY = Math.max(...ys)
      return { x: el.x + minX, y: el.y + minY, width: maxX - minX, height: maxY - minY }
    }
    case 'text': {
      // Dla tekstu bez szerokości przybliżamy: 7px na znak, fontSize wysokość.
      const width = el.width ?? Math.max(20, el.text.length * el.fontSize * 0.6)
      return { x: el.x, y: el.y, width, height: el.fontSize * 1.4 }
    }
    default:
      return { x: el.x, y: el.y, width: el.width, height: el.height }
  }
}
