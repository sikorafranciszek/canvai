import { test } from '@japa/runner'
import {
  emptySceneDocument,
  SCENE_ELEMENT_TYPES,
  type SceneDocument,
  type SceneElement,
} from '#shared/scene'
import { sceneFixture } from '#shared/scene.fixture'

test.group('SceneDocument contract', () => {
  test('emptySceneDocument zwraca pusty dokument z metadanymi', ({ assert }) => {
    const doc = emptySceneDocument()
    assert.deepEqual(doc, { elements: [], metadata: {} })
  })

  test('fixture zawiera po jednym elemencie każdego typu', ({ assert }) => {
    const typesInFixture = sceneFixture.elements.map((e) => e.type)
    for (const type of SCENE_ELEMENT_TYPES) {
      assert.isTrue(typesInFixture.includes(type), `brak elementu typu ${type}`)
    }
    assert.equal(sceneFixture.elements.length, SCENE_ELEMENT_TYPES.length)
  })

  test('serializacja JSON jest bezstratna (round-trip)', ({ assert }) => {
    const roundTripped = JSON.parse(JSON.stringify(sceneFixture)) as SceneDocument
    assert.deepEqual(roundTripped, sceneFixture)
    assert.deepEqual(JSON.parse(JSON.stringify(roundTripped)), roundTripped)
  })

  test('dokument nie zawiera pola version ani kamery', ({ assert }) => {
    const raw = JSON.parse(JSON.stringify(sceneFixture)) as Record<string, unknown>
    assert.notProperty(raw, 'version')
    assert.notProperty(raw, 'zoom')
    assert.notProperty(raw, 'pan')
    assert.notProperty(raw, 'camera')
    assert.notProperty(raw, 'app_state')
  })

  test('element image niesie tylko assetId + geometrię', ({ assert }) => {
    const image = sceneFixture.elements.find((e) => e.type === 'image')
    assert.isDefined(image)
    const img = image as Extract<SceneElement, { type: 'image' }>
    assert.isString(img.assetId)
    assert.isTrue(img.assetId.length > 0)

    // Żadnego base64 / data URL / zapiekanego URL-a.
    const rawImg = JSON.parse(JSON.stringify(img)) as Record<string, unknown>
    for (const key of Object.keys(rawImg)) {
      assert.isFalse(
        key.startsWith('data'),
        `pole ${key} wygląda na data-url, a image może nieść tylko assetId + geometrię`
      )
    }
    assert.notProperty(rawImg, 'src')
    assert.notProperty(rawImg, 'url')
    assert.notProperty(rawImg, 'base64')
  })

  test('każdy element ma id, x, y, rotation, opacity', ({ assert }) => {
    for (const el of sceneFixture.elements) {
      assert.isString(el.id)
      assert.isNumber(el.x)
      assert.isNumber(el.y)
      assert.isNumber(el.rotation)
      assert.isNumber(el.opacity)
    }
  })
})
