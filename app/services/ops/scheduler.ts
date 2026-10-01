import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { raiseAlert } from '#services/ops/alerts'

/**
 * Zadania cykliczne (kopie zapasowe, maile cykliczne). Stan w `scheduler_runs`,
 * więc restart nie powtarza zadania, a dwa procesy nie wykonają go naraz
 * (przejęcie warunkowym UPDATE po `last_run_at`).
 */

export interface ScheduledTask {
  name: string
  /** Czy zadanie powinno ruszyć teraz, biorąc pod uwagę ostatnie uruchomienie. */
  due(lastRunAt: DateTime | null, now: DateTime): boolean
  /** Zwraca krótki opis wyniku (trafia do `scheduler_runs.last_message`). */
  run(): Promise<string>
}

const tasks = new Map<string, ScheduledTask>()

export function registerTask(task: ScheduledTask) {
  tasks.set(task.name, task)
}

export function registeredTasks(): ScheduledTask[] {
  return [...tasks.values()]
}

/** Codziennie o `hourUtc` (albo przy pierwszej okazji po tej godzinie). */
export function dailyAt(hourUtc: number) {
  return (last: DateTime | null, now: DateTime) => {
    const slot = now.startOf('day').set({ hour: hourUtc })
    const latestSlot = now >= slot ? slot : slot.minus({ days: 1 })
    return !last || last < latestSlot
  }
}

export function every(minutes: number) {
  return (last: DateTime | null, now: DateTime) =>
    !last || now.diff(last, 'minutes').minutes >= minutes
}

async function claim(name: string, now: DateTime, task: ScheduledTask): Promise<boolean> {
  await db
    .table('scheduler_runs')
    .insert({ task: name, last_run_at: null })
    .onConflict('task')
    .ignore()
  const row = await db.from('scheduler_runs').where('task', name).first()
  const last = row?.last_run_at ? DateTime.fromJSDate(new Date(row.last_run_at)).toUTC() : null
  if (!task.due(last, now)) return false
  const q = db.from('scheduler_runs').where('task', name)
  if (last) q.where('last_run_at', row.last_run_at)
  else q.whereNull('last_run_at')
  const affected = await q.update({ last_run_at: now.toJSDate(), last_status: 'running' })
  return Number(Array.isArray(affected) ? affected[0] : affected) === 1
}

export async function runTask(task: ScheduledTask) {
  try {
    const message = await task.run()
    await db
      .from('scheduler_runs')
      .where('task', task.name)
      .update({ last_status: 'ok', last_message: message.slice(0, 2000) })
    logger.info({ task: task.name, result: message }, 'scheduled task done')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .from('scheduler_runs')
      .where('task', task.name)
      .update({ last_status: 'failed', last_message: message.slice(0, 2000) })
    logger.warn({ err: error, task: task.name }, 'scheduled task failed')
    raiseAlert(`task_${task.name}`, `Scheduled task "${task.name}" failed: ${message}`)
  }
}

/** Uruchamia zadania, na które przyszła pora. Zwraca nazwy uruchomionych. */
export async function runDueTasks(now = DateTime.utc()): Promise<string[]> {
  const ran: string[] = []
  for (const task of tasks.values()) {
    if (!(await claim(task.name, now, task))) continue
    await runTask(task)
    ran.push(task.name)
  }
  return ran
}

export async function taskStatus() {
  const rows = await db.from('scheduler_runs').select('*')
  return rows.map((r) => ({
    task: r.task as string,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    status: r.last_status as string | null,
    message: r.last_message as string | null,
  }))
}
