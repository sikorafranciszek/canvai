/*
|--------------------------------------------------------------------------
| Kontrola konfiguracji produkcji (REL-3)
|--------------------------------------------------------------------------
|
| Serwer HTTP w produkcji nie wystartuje z konfiguracją, która „działa”, ale
| po cichu robi coś innego: atrapa AI zamiast modelu, DeepSeek bez klucza,
| adres aplikacji wskazujący na localhost. Błąd przy starcie zatrzymuje
| wdrożenie (healthcheck), zamiast wypuścić stronę generującą puste dokumenty.
|
| Wywoływane tylko przy starcie serwera HTTP (bin/server.ts) — NIE jako
| preload: `node ace codegen/build` w obrazie Dockera bootują aplikację z
| atrapami env i wyjątek w preloadzie zawieszał build.
|
*/
import app from '@adonisjs/core/services/app'
import env from '#start/env'

export function productionConfigProblems(get: (key: string) => string | undefined): string[] {
  const problems: string[] = []
  const provider = get('AI_PROVIDER') ?? 'mock'
  if (provider === 'mock' && get('ALLOW_MOCK_AI') !== 'true') {
    problems.push(
      'AI_PROVIDER=mock in production (set AI_PROVIDER=deepseek, or ALLOW_MOCK_AI=true on purpose)'
    )
  }
  if (provider === 'deepseek' && !get('DEEPSEEK_API_KEY')) {
    problems.push('AI_PROVIDER=deepseek without DEEPSEEK_API_KEY')
  }
  const url = get('APP_URL') ?? ''
  if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) {
    problems.push(`APP_URL must be the public https address (got "${url}")`)
  }
  return problems
}

export function assertProductionConfig() {
  if (!app.inProduction) return
  const problems = productionConfigProblems((key) => {
    const value = env.get(key as never) as unknown
    return value === undefined || value === null || value === '' ? undefined : String(value)
  })
  if (problems.length) {
    throw new Error(`Production configuration is not safe to start:\n- ${problems.join('\n- ')}`)
  }
}
