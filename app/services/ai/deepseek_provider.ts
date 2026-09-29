import sharp from 'sharp'
import type { AiProviderConfig } from '#config/ai'
import { limits as defaultLimits, vision as defaultVision } from '#config/ai'
import { parseJsonObject, validateAssetAnalysis } from '#services/ai/schemas'
import { validateDesignSpec } from '#services/design/spec'
import {
  AiProviderError,
  InvalidModelOutputError,
  type AiProvider,
  type AnalyzeAssetInput,
  type AssetAnalysisData,
  type ComposeInput,
  type DesignSpec,
  type ProviderResult,
} from '#services/ai/types'
import {
  ANALYZE_SYSTEM_PROMPT,
  COMPOSE_SYSTEM_PROMPT,
  buildAnalyzeUserText,
  buildComposeUserText,
} from '#services/design/prompts'

/**
 * Dostawca DeepSeek (`api.deepseek.com`, protokół OpenAI Chat Completions).
 *
 * - Obrazy wyłącznie w wiadomości roli `user` (blok `image_url`, data URL).
 * - Limity `vision` z `config/ai.ts` egzekwowane PRZED wywołaniem — dostawca
 *   odpowiada na ich przekroczenie 400, nie miękkim obcięciem.
 * - Ponowienia z backoffem na 429/5xx/timeout i na odpowiedź niezgodną ze schematem.
 * - Klucz API nigdy nie trafia do komunikatów błędów ani logów.
 */

type ChatMessage =
  | { role: 'system'; content: string }
  | {
      role: 'user'
      content:
        | string
        | (
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string; detail?: string } }
          )[]
    }

export interface DeepseekDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  limits?: Pick<typeof defaultLimits, 'maxOutputTokens' | 'requestTimeoutMs' | 'maxRetries'>
  vision?: typeof defaultVision
}

/** Przygotowuje obraz pod limity dostawcy: format, dłuższa krawędź, bajty. */
export async function prepareImageForVision(
  image: { buffer: Buffer; mime: string },
  visionLimits: typeof defaultVision = defaultVision
): Promise<{ dataUrl: string; bytes: number }> {
  let buffer = image.buffer
  let mime = image.mime

  const meta = await sharp(buffer).metadata()
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  const acceptedFormat = (visionLimits.acceptedFormats as readonly string[]).includes(mime)

  if (!acceptedFormat || longest > visionLimits.maxEdgePx) {
    buffer = await sharp(buffer)
      .rotate()
      .resize(visionLimits.maxEdgePx, visionLimits.maxEdgePx, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer()
    mime = 'image/webp'
  }

  // Base64 rośnie o ~4/3 — limit dotyczy zakodowanej postaci.
  const encodedBytes = Math.ceil(buffer.length / 3) * 4
  if (encodedBytes > visionLimits.maxImageBytes) {
    throw new AiProviderError(
      `Obraz przekracza limit dostawcy (${Math.round(encodedBytes / 1024 / 1024)} MiB)`,
      false
    )
  }

  return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, bytes: buffer.length }
}

export class DeepseekProvider implements AiProvider {
  readonly name = 'deepseek'
  readonly analysisModel: string
  readonly compositionModel: string
  readonly vision: boolean

  readonly #fetch: typeof fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #limits: NonNullable<DeepseekDeps['limits']>
  readonly #vision: typeof defaultVision

  constructor(
    private readonly config: AiProviderConfig,
    deps: DeepseekDeps = {}
  ) {
    this.analysisModel = config.visionModel
    this.compositionModel = config.textModel
    this.vision = config.capabilities.vision
    this.#fetch = deps.fetch ?? fetch
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#limits = deps.limits ?? defaultLimits
    this.#vision = deps.vision ?? defaultVision
  }

  async analyzeAsset(input: AnalyzeAssetInput): Promise<ProviderResult<AssetAnalysisData>> {
    const text = buildAnalyzeUserText(this.vision ? input : { ...input, image: null })
    const userContent: Extract<ChatMessage, { role: 'user' }>['content'] = [{ type: 'text', text }]

    if (this.vision && input.image) {
      const prepared = await prepareImageForVision(input.image, this.#vision)
      userContent.push({
        type: 'image_url',
        image_url: { url: prepared.dataUrl, detail: this.#vision.detail },
      })
    }

    const imageCount = userContent.filter((c) => c.type === 'image_url').length
    if (imageCount > this.#vision.maxImagesPerRequest) {
      throw new AiProviderError('Za dużo obrazów w jednym zapytaniu do modelu', false)
    }

    return this.#chatJson(
      this.analysisModel,
      [
        { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      validateAssetAnalysis
    )
  }

  async composeDocument(input: ComposeInput): Promise<ProviderResult<DesignSpec>> {
    return this.#chatJson(
      this.compositionModel,
      [
        { role: 'system', content: COMPOSE_SYSTEM_PROMPT },
        { role: 'user', content: buildComposeUserText(input) },
      ],
      validateDesignSpec
    )
  }

  async #chatJson<T>(
    model: string,
    messages: ChatMessage[],
    validate: (value: unknown) => T
  ): Promise<ProviderResult<T>> {
    if (!this.config.apiKey) {
      throw new AiProviderError(
        'Brak klucza DEEPSEEK_API_KEY w .env — generacja przez DeepSeek jest niedostępna',
        false
      )
    }

    let lastError: AiProviderError | null = null
    const usage = { tokensIn: 0, tokensOut: 0 }

    for (let attempt = 0; attempt <= this.#limits.maxRetries; attempt++) {
      if (attempt > 0) await this.#sleep(Math.min(8000, 500 * 2 ** (attempt - 1)))

      try {
        const body = await this.#request(model, messages)
        usage.tokensIn += body.usage?.prompt_tokens ?? 0
        usage.tokensOut += body.usage?.completion_tokens ?? 0

        const choice = body.choices?.[0]
        if (choice?.finish_reason === 'length') {
          throw new InvalidModelOutputError(
            'Odpowiedź modelu została ucięta (limit tokenów wyjścia)'
          )
        }
        const content = choice?.message?.content
        if (typeof content !== 'string' || !content.trim()) {
          throw new InvalidModelOutputError('Model zwrócił pustą odpowiedź')
        }
        return { data: validate(parseJsonObject(content)), model, usage }
      } catch (error) {
        const err =
          error instanceof AiProviderError
            ? error
            : new AiProviderError('Nieoczekiwany błąd połączenia z dostawcą AI', true)
        if (!err.retryable) throw err
        lastError = err
      }
    }

    throw lastError ?? new AiProviderError('Dostawca AI nie odpowiedział', false)
  }

  async #request(model: string, messages: ChatMessage[]) {
    let res: Response
    try {
      res = await this.#fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: this.#limits.maxOutputTokens,
          temperature: 0.2,
          ...(this.config.capabilities.jsonMode
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: AbortSignal.timeout(this.#limits.requestTimeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw new AiProviderError(
        timedOut ? 'Przekroczono czas odpowiedzi dostawcy AI' : 'Brak połączenia z dostawcą AI',
        true
      )
    }

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500
      const message =
        res.status === 401 || res.status === 403
          ? 'Dostawca AI odrzucił klucz API (sprawdź DEEPSEEK_API_KEY)'
          : res.status === 402
            ? 'Brak środków na koncie dostawcy AI'
            : res.status === 429
              ? 'Dostawca AI ogranicza liczbę zapytań (429)'
              : res.status >= 500
                ? `Dostawca AI jest chwilowo niedostępny (${res.status})`
                : `Dostawca AI odrzucił zapytanie (${res.status})`
      throw new AiProviderError(message, retryable, res.status)
    }

    return (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
  }
}
