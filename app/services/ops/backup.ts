import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { backupConfigured, ops } from '#config/ops'
import { S3Client } from '#services/ops/s3'

/**
 * Kopie zapasowe: `pg_dump` (format custom, skompresowany) → `<prefix><id>/`
 * i przyrostowa kopia plików (uploady) → wspólna pula `<prefix>files/`.
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
  /** Katalog plików (testy podmieniają na katalog tymczasowy). */
  storageRoot: null as string | null,
  dumpDatabase: async (file: string) => {
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], {
      env: pgEnv(),
      maxBuffer: 16 * 1024 * 1024,
    })
  },
  restoreDatabase: async (file: string) => {
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
        file,
      ],
      { env: pgEnv(), maxBuffer: 16 * 1024 * 1024 }
    )
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
  return backupDeps.storageRoot ?? (env.get('STORAGE_PATH') || app.makePath('storage'))
}

/** Identyfikator kopii = znacznik czasu UTC (sortuje się chronologicznie). */
export function backupId(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
}

/** Wszystkie pliki katalogu (ścieżki względne, `/`). */
async function walk(root: string, dir = ''): Promise<{ rel: string; size: number }[]> {
  const out: { rel: string; size: number }[] = []
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await walk(root, rel)))
    else if (entry.isFile()) out.push({ rel, size: (await stat(join(root, rel))).size })
  }
  return out
}

/** Prefiks plików — wspólny dla wszystkich kopii (pliki się nie zmieniają, tylko przybywają). */
const filesPrefix = () => `${ops.backup.prefix}files/`

/**
 * Kopia zapasowa (REL-2): zrzut bazy (upload wieloczęściowy powyżej 128 MB) i
 * PRZYROSTOWA synchronizacja plików do `<prefix>files/` — wysyłane tylko nowe
 * albo zmienione pliki, bez archiwum w /tmp i bez limitu 5 GB pojedynczego PUT.
 * Manifest kopii zapisuje listę plików, więc każdą kopię da się odtworzyć dokładnie.
 */
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
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  const storage = storagePath()
  const local = existsSync(storage) ? await walk(storage) : []
  const remote = new Map((await s3.list(filesPrefix())).map((o) => [o.key, o.size]))
  let uploaded = 0
  let uploadedBytes = 0
  await pool(local, 4, async (f) => {
    const key = `${filesPrefix()}${f.rel}`
    if (remote.get(key) === f.size) return
    await s3.putFile(key, join(storage, f.rel))
    uploaded++
    uploadedBytes += f.size
  })
  if (uploaded) files.push({ key: filesPrefix(), bytes: uploadedBytes })

  await s3.putText(
    `${base}manifest.json`,
    JSON.stringify(
      {
        id,
        createdAt: new Date().toISOString(),
        db: `${base}db.dump`,
        files: local.map((f) => ({ path: f.rel, size: f.size })),
        uploaded,
      },
      null,
      2
    )
  )
  const pruned = await pruneBackups(s3)
  return { id, files, pruned }
}

/** Co najwyżej `concurrency` zadań naraz. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++])
    })
  )
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
    // `files/` to wspólna pula plików, nie kopia.
    if (!id || !file || id === 'files') continue
    const entry = byId.get(id) ?? { id, bytes: 0, files: [] }
    entry.bytes += o.size
    entry.files.push(file)
    byId.set(id, entry)
  }
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id))
}

interface Manifest {
  id: string
  files?: { path: string; size: number }[]
}

async function readManifest(s3: S3Client, id: string): Promise<Manifest | null> {
  const dir = await mkdtemp(join(tmpdir(), 'canvai-manifest-'))
  try {
    const file = join(dir, 'manifest.json')
    await s3.getToFile(`${ops.backup.prefix}${id}/manifest.json`, file)
    return JSON.parse(await readFile(file, 'utf8')) as Manifest
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Usuwa kopie starsze niż `keepDays` (zawsze zostawia najnowszą) i pliki z puli,
 * do których nie odwołuje się już żadna zachowana kopia.
 */
export async function pruneBackups(s3 = backupClient(), now = new Date()): Promise<number> {
  const cutoff = backupId(new Date(now.getTime() - ops.backup.keepDays * 86_400_000))
  const all = await listBackups(s3)
  const old = all.slice(1).filter((b) => b.id < cutoff)
  for (const b of old) {
    for (const f of b.files) await s3.delete(`${ops.backup.prefix}${b.id}/${f}`)
  }
  const kept = all.filter((b) => !old.includes(b))
  const referenced = new Set<string>()
  for (const b of kept) {
    const manifest = await readManifest(s3, b.id)
    // Kopia bez listy plików (stary format / nieczytelny manifest) — nic nie usuwamy.
    if (!manifest?.files) return old.length
    for (const f of manifest.files) referenced.add(`${filesPrefix()}${f.path}`)
  }
  for (const o of await s3.list(filesPrefix())) {
    if (!referenced.has(o.key)) await s3.delete(o.key)
  }
  return old.length
}

/**
 * Odtworzenie kopii — PROCEDURA (docs/backups.md): zatrzymać aplikację, potem
 * `node ace backup:restore <id> --force`. Baza: `pg_restore --clean` w jednej
 * transakcji. Pliki: dokładnie stan z manifestu — brakujące pobrane, pliki
 * spoza kopii usunięte (tar tego nie robił). Stary format (archiwum) też działa.
 */
export async function restoreBackup(id: string, { files = true } = {}) {
  const s3 = backupClient()
  const base = `${ops.backup.prefix}${id}/`
  const dir = await mkdtemp(join(tmpdir(), 'canvai-restore-'))
  try {
    const dump = join(dir, 'db.dump')
    await s3.getToFile(`${base}db.dump`, dump)
    await backupDeps.restoreDatabase(dump)
    if (!files) return { files: false, restored: 0, removed: 0 }

    const storage = storagePath()
    await mkdir(storage, { recursive: true })
    const manifest = await readManifest(s3, id)
    if (manifest?.files) {
      const wanted = new Map(manifest.files.map((f) => [f.path, f.size]))
      let restored = 0
      await pool([...wanted], 4, async ([rel, size]) => {
        const target = join(storage, rel)
        if (existsSync(target) && (await stat(target)).size === size) return
        await mkdir(dirname(target), { recursive: true })
        await s3.getToFile(`${filesPrefix()}${rel}`, target)
        restored++
      })
      let removed = 0
      for (const f of await walk(storage)) {
        if (!wanted.has(f.rel)) {
          await rm(join(storage, f.rel), { force: true })
          removed++
        }
      }
      return { files: true, restored, removed }
    }
    // Stary format: archiwum katalogu plików.
    const archive = join(dir, 'storage.tar.gz')
    try {
      await s3.getToFile(`${base}storage.tar.gz`, archive)
    } catch {
      return { files: false, restored: 0, removed: 0 }
    }
    await run('tar', ['-xzf', archive, '-C', storage])
    return { files: true, restored: -1, removed: 0 }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
