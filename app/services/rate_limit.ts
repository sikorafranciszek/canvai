import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'

/**
 * Limity żądań w bazie (SEC-4) — okno stałe, jedno atomowe UPSERT na trafienie.
 * Wspólne dla wszystkich procesów aplikacji i odporne na restart (w odróżnieniu
 * od liczników w pamięci). Klucze z e-mailem są hashowane — w tabeli nie ma
 * adresów użytkowników.
 */

export interface RateResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

export function rateKey(scope: string, value: string): string {
  const digest = createHash('sha256').update(value.toLowerCase().trim()).digest('base64url')
  return `${scope}:${digest.slice(0, 32)}`
}

export async function hit(key: string, max: number, windowMs: number): Promise<RateResult> {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)
  const result = await db.rawQuery(
    `insert into rate_limits (key, hits, reset_at) values (?, 1, ?)
     on conflict (key) do update set
       hits = case when rate_limits.reset_at <= ? then 1 else rate_limits.hits + 1 end,
       reset_at = case when rate_limits.reset_at <= ? then excluded.reset_at else rate_limits.reset_at end
     returning hits, reset_at`,
    [key, resetAt, now, now]
  )
  const row = result.rows[0] as { hits: number; reset_at: Date }
  const hits = Number(row.hits)
  const retryAfterSec = Math.max(
    1,
    Math.ceil((new Date(row.reset_at).getTime() - now.getTime()) / 1000)
  )
  return { allowed: hits <= max, remaining: Math.max(0, max - hits), retryAfterSec }
}

/** Sprawdza kilka limitów naraz; wszystkie są zliczane. Zwraca najbardziej restrykcyjny wynik. */
export async function hitAll(
  rules: { key: string; max: number; windowMs: number }[]
): Promise<RateResult> {
  const results = await Promise.all(rules.map((r) => hit(r.key, r.max, r.windowMs)))
  const blocked = results.filter((r) => !r.allowed)
  if (blocked.length) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(...blocked.map((b) => b.retryAfterSec)),
    }
  }
  return {
    allowed: true,
    remaining: Math.min(...results.map((r) => r.remaining)),
    retryAfterSec: 0,
  }
}

/** Czyści licznik (np. po udanym logowaniu — błędne próby się nie sumują dalej). */
export async function clear(key: string) {
  await db.from('rate_limits').where('key', key).delete()
}

export async function purgeExpired(): Promise<number> {
  const affected = await db.from('rate_limits').where('reset_at', '<', new Date()).delete()
  return Number(Array.isArray(affected) ? affected[0] : affected)
}
