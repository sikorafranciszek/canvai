import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { ops } from '#config/ops'
import { t } from '#services/i18n'
import { raiseAlert } from '#services/ops/alerts'

/**
 * Bezpieczniki kosztów modelu: dzienne limity globalne i per użytkownik.
 * Kredyty chronią przychód, ale nie chronią przed nadużyciem (np. masowe
 * generacje przez API z darmowych kredytów poleceń) ani przed błędem pętli —
 * stąd twarde sufity sprawdzane przed zleceniem generacji.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function bump(
  userId: number,
  delta: { tokensIn?: number; tokensOut?: number; generations?: number }
) {
  const row = {
    day: today(),
    user_id: userId,
    tokens_in: Math.max(0, Math.round(delta.tokensIn ?? 0)),
    tokens_out: Math.max(0, Math.round(delta.tokensOut ?? 0)),
    generations: delta.generations ?? 0,
  }
  await db
    .table('ai_usage_daily')
    .insert(row)
    .onConflict(['day', 'user_id'])
    .merge({
      tokens_in: db.raw('ai_usage_daily.tokens_in + ?', [row.tokens_in]),
      tokens_out: db.raw('ai_usage_daily.tokens_out + ?', [row.tokens_out]),
      generations: db.raw('ai_usage_daily.generations + ?', [row.generations]),
    })
}

/** Zlecenie generacji (DESIGN.md albo podgląd) — liczone do dziennego limitu użytkownika. */
export async function countGeneration(userId: number) {
  await bump(userId, { generations: 1 })
}

/** Tokeny faktycznie zużyte (także przez generację zakończoną błędem). */
export async function recordAiUsage(
  userId: number,
  usage: { tokensIn: number; tokensOut: number }
) {
  if (!usage.tokensIn && !usage.tokensOut) return
  try {
    await bump(userId, usage)
  } catch (error) {
    logger.warn({ err: error }, 'ai usage not recorded')
  }
}

export interface UsageToday {
  tokens: number
  userTokens: number
  userGenerations: number
}

export async function usageToday(userId?: number): Promise<UsageToday> {
  const day = today()
  const [all] = await db
    .from('ai_usage_daily')
    .where('day', day)
    .sum({ tin: 'tokens_in', tout: 'tokens_out' })
  const mine = userId
    ? await db.from('ai_usage_daily').where({ day, user_id: userId }).first()
    : null
  return {
    tokens: Number(all?.tin ?? 0) + Number(all?.tout ?? 0),
    userTokens: Number(mine?.tokens_in ?? 0) + Number(mine?.tokens_out ?? 0),
    userGenerations: Number(mine?.generations ?? 0),
  }
}

/**
 * Powód odmowy (komunikat dla użytkownika) albo `null`, gdy wolno generować.
 * Przekroczenie limitu globalnego wysyła też alert do administratorów.
 */
export async function aiBudgetDenial(userId: number): Promise<string | null> {
  const limits = ops.aiBudget
  const usage = await usageToday(userId)
  if (limits.dailyTokens > 0 && usage.tokens >= limits.dailyTokens) {
    raiseAlert(
      'ai_budget_global',
      `Global daily AI token budget reached: ${usage.tokens} / ${limits.dailyTokens}. New generations are blocked until 00:00 UTC.`
    )
    return t('ops.budgetGlobal')
  }
  if (limits.userDailyGenerations > 0 && usage.userGenerations >= limits.userDailyGenerations) {
    return t('ops.budgetUserGenerations', { limit: limits.userDailyGenerations })
  }
  if (limits.userDailyTokens > 0 && usage.userTokens >= limits.userDailyTokens) {
    raiseAlert(
      `ai_budget_user_${userId}`,
      `User #${userId} reached the daily AI token limit (${usage.userTokens} / ${limits.userDailyTokens}).`
    )
    return t('ops.budgetUserTokens')
  }
  return null
}
