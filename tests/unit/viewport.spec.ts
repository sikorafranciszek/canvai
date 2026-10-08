import { test } from '@japa/runner'
import { intersects, prefersThumbnail, visibleWorldRect, wheelCamera } from '#shared/viewport'

const limits = { min: 0.1, max: 8 }
const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false }

test.group('Widok płótna (UX-8)', () => {
  test('widoczny prostokąt świata i przecięcia', ({ assert }) => {
    const view = visibleWorldRect({ x: -1000, y: -500, scale: 2 }, { width: 800, height: 600 }, 0)
    assert.deepEqual(view, { x: 500, y: 250, width: 400, height: 300 })
    assert.isTrue(intersects(view, { x: 880, y: 540, width: 50, height: 50 }))
    assert.isFalse(intersects(view, { x: 0, y: 0, width: 100, height: 100 }))
    const padded = visibleWorldRect({ x: 0, y: 0, scale: 1 }, { width: 100, height: 100 }, 0.25)
    assert.deepEqual(padded, { x: -25, y: -25, width: 150, height: 150 })
  })

  test('miniatura tylko, gdy obraz jest mały na ekranie (z gęstością ekranu)', ({ assert }) => {
    assert.isTrue(prefersThumbnail(1280, 800, 0.3))
    assert.isFalse(prefersThumbnail(1280, 800, 0.5))
    assert.isFalse(prefersThumbnail(1280, 800, 0.3, 2), 'ekran retina potrzebuje więcej pikseli')
  })

  test('gładzik przesuwa, Ctrl/⌘ + kółko zoomuje wokół kursora proporcjonalnie', ({ assert }) => {
    const cam = { x: 0, y: 0, scale: 1 }
    assert.deepEqual(
      wheelCamera(cam, { x: 0, y: 0 }, { ...base, deltaX: 30, deltaY: 40 }, limits),
      {
        x: -30,
        y: -40,
        scale: 1,
      }
    )
    assert.deepEqual(
      wheelCamera(cam, { x: 0, y: 0 }, { ...base, deltaY: 50, shiftKey: true }, limits),
      {
        x: -50,
        y: 0,
        scale: 1,
      }
    )
    const small = wheelCamera(
      cam,
      { x: 100, y: 100 },
      { ...base, deltaY: -2, ctrlKey: true },
      limits
    )
    const big = wheelCamera(
      cam,
      { x: 100, y: 100 },
      { ...base, deltaY: -40, ctrlKey: true },
      limits
    )
    assert.isAbove(small.scale, 1)
    assert.isAbove(big.scale, small.scale, 'większy gest = większy zoom')
    // Punkt pod kursorem zostaje w miejscu.
    const wx = (100 - big.x) / big.scale
    assert.closeTo(wx, 100, 1e-9)
    const out = wheelCamera(cam, { x: 0, y: 0 }, { ...base, deltaY: 10_000, metaKey: true }, limits)
    assert.equal(out.scale, 0.1)
  })
})
