/**
 * Helpers `prepare`/`consume` dla kolumn JSON (jsonb) w modelach Lucid.
 * Lucid sam nie serializuje obiektów — kolumna jsonb wymaga jawnego
 * `prepare` (JSON.stringify przed zapisem) i `consume` (JSON.parse po odczycie).
 */

export function jsonPrepare(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

export function jsonConsume(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
