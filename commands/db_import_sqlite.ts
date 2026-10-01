import { existsSync } from 'node:fs'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace db:import-sqlite` — jednorazowe przeniesienie danych ze starej
 * bazy SQLite (plik z wolumenu) do PostgreSQL, z zachowaniem identyfikatorów.
 *
 * - Najpierw muszą przejść migracje Postgresa (schemat jest nadzbiorem SQLite).
 * - `--if-empty`: nic nie robi, jeśli w Postgresie są już użytkownicy
 *   (bezpieczne do uruchamiania przy każdym starcie kontenera).
 * - Wszystko w jednej transakcji, tabele w kolejności zależności.
 * - Stara baza działała długo bez egzekwowania kluczy obcych, więc mogą w niej
 *   być „sieroty” (np. materiały usuniętej tablicy). Odwołanie do nieistniejącego
 *   rodzica: przy `ON DELETE SET NULL` → NULL, w pozostałych przypadkach wiersz
 *   jest pomijany (raport podaje liczbę).
 * - Wartości są dopasowywane do typów kolumn Postgresa (0/1 → boolean, tekst
 *   JSON → json, daty SQLite w UTC), a sekwencje `id` ustawiane na maksimum.
 */
export default class DbImportSqlite extends BaseCommand {
  static commandName = 'db:import-sqlite'
  static description = 'Importuje dane ze starej bazy SQLite do PostgreSQL (jednorazowo)'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Ścieżka do pliku SQLite (domyślnie SQLITE_PATH)' })
  declare source: string

  @flags.boolean({ description: 'Pomiń, jeśli PostgreSQL ma już użytkowników' })
  declare ifEmpty: boolean

  @flags.boolean({ description: 'Tylko pokaż, co zostałoby zaimportowane' })
  declare dryRun: boolean

  /** Kolejność zgodna z zależnościami (dla czytelności raportu). */
  static ORDER = [
    'users',
    'user_tokens',
    'api_tokens',
    'boards',
    'board_scenes',
    'assets',
    'asset_analyses',
    'design_docs',
    'design_previews',
    'jobs',
    'credit_grants',
    'credit_transactions',
    'subscriptions',
    'board_shares',
    'portal_feedback',
    'brand_kits',
    'crm_notes',
  ]

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { default: env } = await import('#start/env')
    const { default: app } = await import('@adonisjs/core/services/app')

    const source = this.source || env.get('SQLITE_PATH') || app.tmpPath('db.sqlite3')
    if (!existsSync(source)) {
      this.logger.info(`Brak pliku SQLite (${source}) — nic do importu.`)
      return
    }

    const pg = db.connection('pg')
    if (this.ifEmpty) {
      const [{ n }] = await pg.from('users').count('* as n')
      if (Number(n) > 0) {
        this.logger.info('PostgreSQL ma już dane — import pominięty.')
        return
      }
    }

    // Połączenie do konkretnego pliku (może różnić się od domyślnego SQLITE_PATH).
    db.manager.patch('sqlite_import', {
      client: 'better-sqlite3',
      connection: { filename: source },
      useNullAsDefault: true,
    })
    const lite = db.connection('sqlite_import')

    const liteTables = (
      await lite.rawQuery(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'adonis_schema%'"
      )
    ).map((r: { name: string }) => r.name) as string[]

    const pgColumns = (
      await pg.rawQuery(
        `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`
      )
    ).rows as { table_name: string; column_name: string; data_type: string }[]
    const types = new Map<string, Map<string, string>>()
    for (const c of pgColumns) {
      if (!types.has(c.table_name)) types.set(c.table_name, new Map())
      types.get(c.table_name)!.set(c.column_name, c.data_type)
    }

    const fkRows = (
      await pg.rawQuery(
        `select tc.table_name, kcu.column_name, ccu.table_name as foreign_table, rc.delete_rule
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
         where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`
      )
    ).rows as {
      table_name: string
      column_name: string
      foreign_table: string
      delete_rule: string
    }[]
    const fks = new Map<string, typeof fkRows>()
    for (const fk of fkRows) {
      if (!fks.has(fk.table_name)) fks.set(fk.table_name, [])
      fks.get(fk.table_name)!.push(fk)
    }

    const tables = [
      ...DbImportSqlite.ORDER.filter((t) => liteTables.includes(t)),
      ...liteTables.filter((t) => !DbImportSqlite.ORDER.includes(t)),
    ].filter((t) => types.has(t))
    const skipped = liteTables.filter((t) => !types.has(t))
    if (skipped.length)
      this.logger.warning(`Tabele bez odpowiednika w PostgreSQL (pominięte): ${skipped.join(', ')}`)

    const convert = (value: unknown, type: string | undefined) => {
      if (value === null || value === undefined) return null
      if (type === 'boolean')
        return value === 1 || value === '1' || value === true || value === 'true'
      if (type === 'json' || type === 'jsonb') {
        if (typeof value !== 'string') return JSON.stringify(value)
        try {
          JSON.parse(value)
          return value
        } catch {
          return JSON.stringify(value)
        }
      }
      if (type?.startsWith('timestamp')) {
        if (typeof value === 'number') return new Date(value).toISOString()
        // SQLite: „YYYY-MM-DD HH:MM:SS” zapisane w UTC.
        const s = String(value)
        return /Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`
      }
      return value
    }

    const report: { table: string; rows: number; dropped: number; nulled: number }[] = []
    /** Identyfikatory zaimportowanych wierszy — do sprawdzania odwołań. */
    const kept = new Map<string, Set<number>>()
    const run = async (trx: any) => {
      await trx.rawQuery("SET LOCAL TIME ZONE 'UTC'")
      for (const table of tables) {
        const cols = types.get(table)!
        const all = (await lite.from(table).select('*')) as Record<string, unknown>[]
        // Odwołania do samej siebie (users.referred_by_id) — rodzicami są wiersze tej tabeli.
        if (all.length && 'id' in all[0]) kept.set(table, new Set(all.map((r) => Number(r.id))))
        let dropped = 0
        let nulled = 0
        const rows = all.filter((row) => {
          for (const fk of fks.get(table) ?? []) {
            const value = row[fk.column_name]
            if (value === null || value === undefined) continue
            if (kept.get(fk.foreign_table)?.has(Number(value))) continue
            if (fk.delete_rule === 'SET NULL') {
              row[fk.column_name] = null
              nulled++
              continue
            }
            dropped++
            return false
          }
          return true
        })
        if ('id' in (all[0] ?? {})) kept.set(table, new Set(rows.map((r) => Number(r.id))))
        report.push({ table, rows: rows.length, dropped, nulled })
        if (this.dryRun || rows.length === 0) continue
        const mapped = rows.map((row) => {
          const out: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(row)) {
            if (cols.has(key)) out[key] = convert(value, cols.get(key))
          }
          return out
        })
        for (let i = 0; i < mapped.length; i += 500) {
          await trx.table(table).multiInsert(mapped.slice(i, i + 500))
        }
        if (cols.has('id')) {
          await trx.rawQuery(
            `select setval(pg_get_serial_sequence(?, 'id'), coalesce(max(id), 1), max(id) is not null) from "${table}"`,
            [table]
          )
        }
      }
    }

    try {
      if (this.dryRun) await run(pg)
      else await pg.transaction(run)
    } finally {
      await db.manager.close('sqlite_import')
    }

    for (const r of report) {
      const notes = [
        r.dropped ? `pominięte sieroty: ${r.dropped}` : '',
        r.nulled ? `wyzerowane odwołania: ${r.nulled}` : '',
      ]
        .filter(Boolean)
        .join(', ')
      this.logger.info(`${r.table}: ${r.rows}${notes ? ` (${notes})` : ''}`)
    }
    this.logger.success(
      this.dryRun
        ? 'Próba zakończona — nic nie zapisano.'
        : `Zaimportowano dane z ${source} do PostgreSQL.`
    )
  }
}
