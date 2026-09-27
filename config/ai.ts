import env from '#start/env'

/**
 * Konfiguracja dostawcy modelu dla pipeline'u M3 (analiza assetów → DESIGN.md).
 *
 * Wybór dostawcy: DeepSeek (`api.deepseek.com`), decyzja tablicy z 2026-09-27.
 * API jest zgodne z OpenAI Chat Completions, więc klient z M3 mówi jednym
 * protokołem do `deepseek` i do ewentualnego przyszłego dostawcy OpenAI-owego.
 *
 * KLUCZ API: zmienna `DEEPSEEK_API_KEY` w pliku `.env` w katalogu głównym
 * projektu (patrz `.env.example`). Klucz NIE trafia do repozytorium i NIE jest
 * nigdy przekazywany do przeglądarki — cały ruch do modelu idzie z serwera.
 *
 * WAŻNE OGRANICZENIE: `api.deepseek.com` udostępnia wyłącznie modele tekstowe
 * (`deepseek-chat`, `deepseek-reasoner`) — nie przyjmuje obrazów na wejściu.
 * Dlatego `capabilities.vision` to `false`, a pipeline M3 musi sprawdzić tę
 * flagę przed wysłaniem assetu typu `image` i nie może zakładać, że opis
 * obrazu powstanie w tym samym wywołaniu co synteza dokumentu.
 */

export const aiProviders = ['mock', 'deepseek'] as const

export type AiProvider = (typeof aiProviders)[number]

export interface AiProviderCapabilities {
  /** Czy dostawca przyjmuje obrazy na wejściu (multimodalność). */
  vision: boolean
  /** Czy dostawca wymusza wyjście w formacie JSON. */
  jsonMode: boolean
}

export interface AiProviderConfig {
  baseUrl: string
  /** Model do syntezy tekstu (generowanie DESIGN.md). */
  textModel: string
  /** Model do rozumowania nad strukturą dokumentu; może być ten sam. */
  reasoningModel: string
  capabilities: AiProviderCapabilities
  /** Klucz API; `null` dla dostawcy `mock`. */
  apiKey: string | null
}

/** Dostawca aktywny w tym uruchomieniu; `mock` nie wykonuje żadnych zapytań sieciowych. */
export const provider: AiProvider = env.get('AI_PROVIDER', 'mock') as AiProvider

const deepseekKey = env.get('DEEPSEEK_API_KEY')

export const providers: Record<AiProvider, AiProviderConfig> = {
  mock: {
    baseUrl: 'http://localhost/mock',
    textModel: 'mock-text',
    reasoningModel: 'mock-text',
    capabilities: { vision: false, jsonMode: true },
    apiKey: null,
  },
  deepseek: {
    baseUrl: env.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    textModel: env.get('DEEPSEEK_TEXT_MODEL', 'deepseek-chat'),
    reasoningModel: env.get('DEEPSEEK_REASONING_MODEL', 'deepseek-reasoner'),
    capabilities: { vision: false, jsonMode: true },
    apiKey: deepseekKey ?? null,
  },
}

/** Konfiguracja aktywnego dostawcy. */
export const active = providers[provider]

/**
 * Czy aktywny dostawca jest gotowy do pracy. Dostawca bez klucza NIE jest
 * błędem konfiguracji aplikacji — pipeline ma wtedy zwrócić czytelny komunikat
 * zamiast wywalić proces przy starcie.
 */
export function isReady(): boolean {
  return provider === 'mock' || Boolean(active.apiKey)
}

/**
 * Limity jednego zadania generowania — trzymane tutaj, żeby dały się zmienić
 * bez ruszania logiki kolejki w M3.
 */
export const limits = {
  /** Maksymalna liczba tokenów odpowiedzi modelu. */
  maxOutputTokens: 8000,
  /** Timeout jednego zapytania do modelu (ms). */
  requestTimeoutMs: 120_000,
  /** Liczba ponowień przy błędzie 429/5xx. */
  maxRetries: 3,
  /** Maksymalna liczba assetów wysyłanych w jednym zadaniu analizy. */
  maxAssetsPerJob: 40,
} as const
