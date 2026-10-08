/**
 * Widok płótna (UX-8) — czysta logika (bez Reacta/Konvy), testowana w
 * `tests/unit/viewport.spec.ts`: co jest widoczne, kiedy wystarczy miniatura
 * i jak kółko/gładzik zmienia kamerę.
 */

export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Prostokąt świata widoczny na ekranie, powiększony o `margin` (ułamek rozmiaru). */
export function visibleWorldRect(
  camera: Camera,
  size: { width: number; height: number },
  margin = 0.25
): Rect {
  const w = size.width / camera.scale
  const h = size.height / camera.scale
  const x = -camera.x / camera.scale
  const y = -camera.y / camera.scale
  return {
    x: x - w * margin,
    y: y - h * margin,
    width: w * (1 + 2 * margin),
    height: h * (1 + 2 * margin),
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Rozdzielczość miniatury serwera (dłuższa krawędź). */
export const THUMB_PX = 512

/** Czy obraz na ekranie jest na tyle mały, że miniatura wystarczy (z gęstością ekranu). */
export function prefersThumbnail(worldWidth: number, worldHeight: number, scale: number, dpr = 1) {
  return Math.max(worldWidth, worldHeight) * scale * dpr <= THUMB_PX
}

export interface WheelInput {
  deltaX: number
  deltaY: number
  /** 0 = piksele, 1 = linie, 2 = strony (WheelEvent.deltaMode). */
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Kółko i gładzik: Ctrl/⌘ + kółko oraz gest szczypania (przeglądarki wysyłają
 * go jako kółko z ctrlKey) zoomują proporcjonalnie do deltaY wokół kursora;
 * zwykłe przewijanie przesuwa widok (Shift — w poziomie).
 */
export function wheelCamera(
  camera: Camera,
  pointer: { x: number; y: number },
  e: WheelInput,
  limits: { min: number; max: number }
): Camera {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  const dx = e.deltaX * unit
  const dy = e.deltaY * unit
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-dy * 0.01)
    const scale = Math.min(limits.max, Math.max(limits.min, camera.scale * factor))
    const wx = (pointer.x - camera.x) / camera.scale
    const wy = (pointer.y - camera.y) / camera.scale
    return { scale, x: pointer.x - wx * scale, y: pointer.y - wy * scale }
  }
  if (e.shiftKey && dx === 0) return { ...camera, x: camera.x - dy }
  return { ...camera, x: camera.x - dx, y: camera.y - dy }
}

export interface PinchStart {
  camera: Camera
  /** Środek dwóch palców (w pikselach płótna). */
  center: { x: number; y: number }
  /** Odległość między palcami na starcie gestu. */
  distance: number
}

/**
 * Szczypanie i przesuwanie dwoma palcami (UX-12): skala rośnie z odległością
 * palców, a punkt świata pod środkiem gestu podąża za środkiem palców.
 */
export function pinchCamera(
  start: PinchStart,
  now: { center: { x: number; y: number }; distance: number },
  limits: { min: number; max: number }
): Camera {
  const ratio = start.distance > 0 ? now.distance / start.distance : 1
  const scale = Math.min(limits.max, Math.max(limits.min, start.camera.scale * ratio))
  const wx = (start.center.x - start.camera.x) / start.camera.scale
  const wy = (start.center.y - start.camera.y) / start.camera.scale
  return { scale, x: now.center.x - wx * scale, y: now.center.y - wy * scale }
}
