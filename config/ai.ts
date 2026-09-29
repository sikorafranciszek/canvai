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
 * MULTIMODALNOŚĆ: `deepseek-flash` przyjmuje obrazy na wejściu (bloki
 * `image_url` w formacie OpenAI), `deepseek-v4-pro` jest tekstowy. Dlatego
 * modelem analizy assetów jest `deepseek-flash`, a `capabilities.vision` to
 * `true`. Pipeline M3 nadal czyta tę flagę zamiast zakładać multimodalność —
 * dostawca `mock` ma ją na `false`, a testy muszą przechodzić oba warianty.
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
  /**
   * Model analizy pojedynczego assetu — MUSI być multimodalny, jeśli
   * `capabilities.vision` jest `true`.
   */
  visionModel: string
  /** Model do syntezy tekstu (składanie DESIGN.md z ustrukturyzowanych opisów). */
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
    visionModel: 'mock-text',
    textModel: 'mock-text',
    reasoningModel: 'mock-text',
    capabilities: { vision: false, jsonMode: true },
    apiKey: null,
  },
  deepseek: {
    baseUrl: env.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    visionModel: env.get('DEEPSEEK_VISION_MODEL', 'deepseek-flash'),
    textModel: env.get('DEEPSEEK_TEXT_MODEL', 'deepseek-flash'),
    reasoningModel: env.get('DEEPSEEK_REASONING_MODEL', 'deepseek-v4-pro'),
    capabilities: { vision: true, jsonMode: true },
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
 * Ograniczenia wejścia obrazowego wymuszane przez `api.deepseek.com`. Trzymane
 * w konfiguracji, bo pipeline musi je egzekwować PRZED wysłaniem zapytania —
 * przekroczenie kończy się 400, nie miękkim obcięciem.
 */
export const vision = {
  /** Maksymalna liczba obrazów w jednym zapytaniu (limit dostawcy: 600). */
  maxImagesPerRequest: 24,
  /** Maksymalny rozmiar jednego obrazu w bajtach (limit dostawcy: 32 MiB dla base64/URL). */
  maxImageBytes: 32 * 1024 * 1024,
  /**
   * Dłuższa krawędź wariantu `analysis` wysyłanego do modelu. Dostawca sam
   * skaluje do ~1300x1300 px sumarycznie, więc wysyłanie więcej to czysty
   * transfer bez zysku jakości.
   */
  maxEdgePx: 1300,
  /** `detail` dla bloku `image_url`: 'low' skaluje do 512x512, 'original' zachowuje wymiary. */
  detail: 'original' as 'low' | 'high' | 'original' | 'auto',
  /** Formaty przyjmowane przez dostawcę (rozpoznawane po zawartości, nie po nazwie). */
  acceptedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const,
  /**
   * Obrazy wolno wysyłać WYŁĄCZNIE w wiadomościach roli `user`; obraz w
   * `system` albo `assistant` kończy się błędem 400.
   */
  imagesAllowedInRoles: ['user'] as const,
} as const

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
  /**
   * Twardy sufit tokenów (wejście + wyjście) na jedną generację. Przekroczenie
   * przerywa generację z czytelnym błędem — nigdy cichym obcięciem.
   */
  maxTokensPerGeneration: 400_000,
  /** Ile analiz assetów leci równolegle do dostawcy. */
  analysisConcurrency: 4,
  /** Po jakim czasie zadanie `running` bez postępu uznajemy za porzucone (ms). */
  jobLockTimeoutMs: 10 * 60_000,
} as const
