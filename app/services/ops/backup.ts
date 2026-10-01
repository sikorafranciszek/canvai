import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { backupConfigured, ops } from '#config/ops'
import { S3Client } from '#services/ops/s3'

/**
 * Kopie zapasowe: `pg_dump` (format custom, skompresowany) i archiwum katalogu
 * plików (uploady) → bucket S3/R2 pod `<prefix><znacznik czasu>/`.
 * Starsze niż `keepDays` są usuwane. Odtwarzanie: `node ace backup:restore`.
 */

const run = promisify(execFile)

export interface BackupResult {
  id: string
  files: { key: string; bytes: number }[]
  pruned: number
}

/** Zależności podmieniane w testach (lokalny pg_dump może mieć inną wersję niż serwer). */
export const backupDeps = {
  dumpDatabase: async (file: string) => {
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], {
      env: pgEnv(),
      maxBuffer: 16 * 1024 * 1024,
    })
  },
}

export function backupClient(): S3Client {
  if (!backupConfigured()) throw new Error('Kopie zapasowe nie są skonfigurowane (BACKUP_S3_*).')
  return new S3Client(ops.backup)
}

function pgEnv() {
  return {
    ...process.env,
    PGHOST: env.get('DB_HOST') || '127.0.0.1',
    PGPORT: String(env.get('DB_PORT') || 5432),
    PGUSER: env.get('DB_USER') || 'postgres',
    PGPASSWORD: env.get('DB_PASSWORD') || '',
    PGDATABASE: env.get('DB_DATABASE') || 'canvai',
  }
}

export function storagePath(): string {
  return env.get('STORAGE_PATH') || app.makePath('storage')
}

/** Identyfikator kopii = znacznik czasu UTC (sortuje się chronologicznie). */
export function backupId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
}

export async function runBackup(): Promise<BackupResult> {
  const s3 = backupClient()
  const id = backupId()
  const base = `${ops.backup.prefix}${id}/`
  const dir = await mkdtemp(join(tmpdir(), 'canvai-backup-'))
  const files: BackupResult['files'] = []
  try {
    const dump = join(dir, 'db.dump')
    await backupDeps.dumpDatabase(dump)
    files.push({ key: `${base}db.dump`, bytes: await s3.putFile(`${base}db.dump`, dump) })

    const storage = storagePath()
    if (existsSync(storage)) {
      const archive = join(dir, 'storage.tar.gz')
      await run('tar', ['-czf', archive, '-C', storage, '.'], { maxBuffer: 16 * 1024 * 1024 })
      files.push({
        key: `${base}storage.tar.gz`,
        bytes: await s3.putFile(`${base}storage.tar.gz`, archive, 'application/gzip'),
      })
    }

    await s3.putText(
      `${base}manifest.json`,
      JSON.stringify({ id, createdAt: new Date().toISOString(), files }, null, 2)
    )
    const pruned = await pruneBackups(s3)
    return { id, files, pruned }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export interface BackupEntry {
  id: string
  bytes: number
  files: string[]
}

export async function listBackups(s3 = backupClient()): Promise<BackupEntry[]> {
  const objects = await s3.list(ops.backup.prefix)
  const byId = new Map<string, BackupEntry>()
  for (const o of objects) {
    const rest = o.key.slice(ops.backup.prefix.length)
    const [id, file] = rest.split('/')
    if (!id || !file) continue
    const entry = byId.get(id) ?? { id, bytes: 0, files: [] }
    entry.bytes += o.size
    entry.files.push(file)
    byId.set(id, entry)
  }
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id))
}

/** Usuwa kopie starsze niż `keepDays` (zawsze zostawia najnowszą). */
export async function pruneBackups(s3 = backupClient(), now = new Date()): Promise<number> {
  const cutoff = backupId(new Date(now.getTime() - ops.backup.keepDays * 86_400_000))
  const all = await listBackups(s3)
  const old = all.slice(1).filter((b) => b.id < cutoff)
  for (const b of old) {
    for (const f of b.files) await s3.delete(`${ops.backup.prefix}${b.id}/${f}`)
  }
  return old.length
}

/**
 * Odtworzenie kopii: baza (`pg_restore --clean`) i pliki (rozpakowanie do
 * katalogu storage). Nadpisuje bieżące dane — wołający musi to potwierdzić.
 */
export async function restoreBackup(id: string, { files = true } = {}) {
  const s3 = backupClient()
  const base = `${ops.backup.prefix}${id}/`
  const dir = await mkdtemp(join(tmpdir(), 'canvai-restore-'))
  try {
    const dump = join(dir, 'db.dump')
    await s3.getToFile(`${base}db.dump`, dump)
    await run(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        '--dbname',
        pgEnv().PGDATABASE,
        dump,
      ],
      { env: pgEnv(), maxBuffer: 16 * 1024 * 1024 }
    )
    if (files) {
      const archive = join(dir, 'storage.tar.gz')
      try {
        await s3.getToFile(`${base}storage.tar.gz`, archive)
      } catch {
        return { files: false }
      }
      await mkdir(storagePath(), { recursive: true })
      await run('tar', ['-xzf', archive, '-C', storagePath()])
    }
    return { files }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
