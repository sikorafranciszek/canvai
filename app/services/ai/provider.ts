import { active, isReady, provider as activeProviderName } from '#config/ai'
import { DeepseekProvider } from '#services/ai/deepseek_provider'
import { MockProvider } from '#services/ai/mock_provider'
import type { AiProvider } from '#services/ai/types'
import { t } from '#services/i18n'

/**
 * Fabryka dostawcy AI. Testy mogą podmienić dostawcę przez `setProviderOverride`
 * (np. na `MockProvider` ze szpiegiem albo `DeepseekProvider` z fałszywym `fetch`).
 */
let override: AiProvider | null = null

export function setProviderOverride(provider: AiProvider | null): void {
  override = provider
}

export function getProvider(): AiProvider {
  if (override) return override
  if (activeProviderName === 'deepseek') return new DeepseekProvider(active)
  return new MockProvider()
}

/** Czy da się teraz generować (mock zawsze; deepseek tylko z kluczem). */
export function providerReady(): boolean {
  return override !== null || isReady()
}

export function providerNotReadyMessage(): string {
  return t('ai.noKey')
}
