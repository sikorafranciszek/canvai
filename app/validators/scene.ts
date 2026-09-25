import { Exception } from '@adonisjs/core/exceptions'

/**
 * Walidacja koperty `PUT /api/boards/:id/scene`.
 *
 * Celowo NIE używamy vine dla `document` — dokument musi przejść bezstratnie
 * (nieznane typy elementów i nieznane pola bez obcinania). Walidujemy tylko
 * kopertę (`version`, `document`, `appState`) i regułę elementu `image`.
 */

export interface SceneEnvelope {
  version: number
  document: Record<string, unknown>
  appState: Record<string, unknown> | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Sprawdza regułę elementu `image`: assetId + geometria, bez data URL / URL. */
function validateImageRule(document: Record<string, unknown>): void {
  const elements = document.elements
  if (elements === undefined) return
  if (!Array.isArray(elements)) {
    throw new Exception('Pole „document.elements” musi być tablicą', {
      status: 422,
      code: 'E_SCENE_INVALID_ELEMENTS',
    })
  }

  for (const element of elements) {
    if (!isObject(element) || element.type !== 'image') continue

    const assetId = element.assetId
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new Exception('Element image musi zawierać „assetId” (string)', {
        status: 422,
        code: 'E_SCENE_INVALID_IMAGE',
      })
    }
    if (assetId.startsWith('data:') || assetId.includes('://') || /\s/.test(assetId)) {
      throw new Exception('Element image nie może nieść data URL ani zapiekanego URL-a', {
        status: 422,
        code: 'E_SCENE_INVALID_IMAGE',
      })
    }
  }
}

/** Waliduje kopertę sceny i zwraca znormalizowane pola (bez obcinania dokumentu). */
export function validateSceneEnvelope(body: unknown): SceneEnvelope {
  if (!isObject(body)) {
    throw new Exception('Treść żądania musi być obiektem JSON', {
      status: 422,
      code: 'E_SCENE_INVALID_BODY',
    })
  }

  const { version, document, appState } = body

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Exception('Pole „version” musi być liczbą całkowitą >= 1', {
      status: 422,
      code: 'E_SCENE_INVALID_VERSION',
    })
  }

  if (!isObject(document)) {
    throw new Exception('Pole „document” jest wymagane i musi być obiektem', {
      status: 422,
      code: 'E_SCENE_INVALID_DOCUMENT',
    })
  }

  if (appState !== undefined && appState !== null && !isObject(appState)) {
    throw new Exception('Pole „appState” musi być obiektem', {
      status: 422,
      code: 'E_SCENE_INVALID_APP_STATE',
    })
  }

  validateImageRule(document)

  return {
    version,
    document,
    appState: isObject(appState) ? appState : null,
  }
}
