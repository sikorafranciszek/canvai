import { statfs } from 'node:fs/promises'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { limits } from '#config/ai'
import { backupConfigured } from '#config/ops'
import { stats as analyticsStats } from '#services/analytics/collector'
import { storagePath } from '#services/ops/backup'

/**
 * Stan aplikacji dla monitoringu (REL-1). `/health` sprawdza tylko, czy proces
 * żyje i baza odpowiada (dla Coolify); `/health/deep` sprawdza to, co psuje się
 * po cichu: zawieszony worker, kolejka, dysk, kopie zapasowe, analityka.
 */

export type CheckStatus = 'ok' | 'degraded' | 'fail'

export interface HealthCheck {
  status: CheckStatus
  detail: string
}

/** Puls workera kolejki (ustawiany w start/worker.ts). */
export const workerPulse = ((globalThis as any).__canvaiWorkerPulse ??= {
  enabled: false,
  lastTickAt: 0,
  busySince: 0,
}) as { enabled: boolean; lastTickAt: number; busySince: number }

const MIN = 60_000

function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.includes('fail') ? 'fail' : statuses.includes('degraded') ? 'degraded' : 'ok'
}

async function check(fn: () => Promise<HealthCheck>): Promise<HealthCheck> {
  try {
    return await fn()
  } catch (error) {
    return { status: 'fail', detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function deepHealth(now = Date.now()) {
  const checks: Record<string, HealthCheck> = {}

  checks.database = await check(async () => {
    const started = Date.now()
    await db.rawQuery('select 1')
    const ms = Date.now() - started
    return { status: ms > 1000 ? 'degraded' : 'ok', detail: `${ms} ms` }
  })

  checks.worker = await check(async () => {
    if (!workerPulse.enabled) return { status: 'ok', detail: 'inline worker disabled' }
    const age = now - workerPulse.lastTickAt
    if (workerPulse.busySince) {
      return {
        status: 'ok',
        detail: `busy for ${Math.round((now - workerPulse.busySince) / 1000)} s`,
      }
    }
    return age > 2 * MIN
      ? { status: 'fail', detail: `no tick for ${Math.round(age / 1000)} s` }
      : { status: 'ok', detail: `last tick ${Math.round(age / 1000)} s ago` }
  })

  checks.queue = await check(async () => {
    const [queued] = await db
      .from('jobs')
      .where('status', 'queued')
      .where((q) => q.whereNull('run_at').orWhere('run_at', '<=', new Date(now)))
      .min('created_at as oldest')
      .count('* as n')
    const stale = await db
      .from('jobs')
      .where('status', 'running')
      .where('locked_at', '<', new Date(now - limits.jobLockTimeoutMs))
      .count('* as n')
    const waitingMin = queued?.oldest ? (now - new Date(queued.oldest).getTime()) / MIN : 0
    const staleCount = Number(stale[0]?.n ?? 0)
    const detail = `${Number(queued?.n ?? 0)} queued (oldest ${Math.round(waitingMin)} min), ${staleCount} stuck`
    if (staleCount > 0 || waitingMin > 30) return { status: 'fail', detail }
    if (waitingMin > 10) return { status: 'degraded', detail }
    return { status: 'ok', detail }
  })

  checks.disk = await check(async () => {
    const fs = await statfs(storagePath())
    const free = fs.bavail * fs.bsize
    const total = fs.blocks * fs.bsize
    const pct = total ? (free / total) * 100 : 100
    const detail = `${(free / 1024 ** 3).toFixed(1)} GB free (${pct.toFixed(0)}%)`
    if (pct < 3) return { status: 'fail', detail }
    if (pct < 10 || free < 2 * 1024 ** 3) return { status: 'degraded', detail }
    return { status: 'ok', detail }
  })

  checks.backup = await check(async () => {
    if (!backupConfigured()) return { status: 'degraded', detail: 'not configured (BACKUP_S3_*)' }
    const row = await db.from('scheduler_runs').where('task', 'backup').first()
    if (!row?.last_run_at) return { status: 'degraded', detail: 'no backup yet' }
    const ageH = (now - new Date(row.last_run_at).getTime()) / 3_600_000
    const detail = `${row.last_status} ${Math.round(ageH)} h ago`
    if (row.last_status === 'failed') return { status: 'fail', detail }
    if (ageH > 26) return { status: 'degraded', detail }
    return { status: 'ok', detail }
  })

  checks.analytics = await check(async () => {
    const s = analyticsStats()
    if (s.sink !== 'clickhouse') return { status: 'ok', detail: `sink ${s.sink}` }
    if (s.lastFlush && !s.lastFlush.ok) {
      return { status: 'degraded', detail: `flush failing, ${s.buffered} buffered` }
    }
    return { status: 'ok', detail: `${s.buffered} buffered, ${s.dropped} dropped` }
  })

  checks.config = await check(async () => {
    const problems: string[] = []
    if (env.get('NODE_ENV') === 'production' && (env.get('AI_PROVIDER') ?? 'mock') === 'mock') {
      problems.push('AI_PROVIDER=mock in production')
    }
    return problems.length
      ? { status: 'degraded', detail: problems.join('; ') }
      : { status: 'ok', detail: 'ok' }
  })

  return { status: worst(Object.values(checks).map((c) => c.status)), checks }
}
