import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Integralność wersji DESIGN.md (DAT-2):
 * - unikalny numer wersji w tablicy,
 * - najwyżej jedna generacja w toku na tablicę.
 * Istniejące duplikaty (z dawnego wyścigu) są przenumerowywane / zamykane.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(`
        with d as (
          select id, board_id,
                 row_number() over (partition by board_id, version order by id) as rn
          from design_docs
        ),
        m as (select board_id, max(version) as mx from design_docs group by board_id),
        x as (
          select d.id, m.mx + row_number() over (partition by d.board_id order by d.id) as nv
          from d join m on m.board_id = d.board_id
          where d.rn > 1
        )
        update design_docs set version = x.nv from x where design_docs.id = x.id
      `)
      await db.rawQuery(`
        update design_docs set status = 'failed', error = 'Superseded by a newer generation'
        where status in ('queued', 'running')
          and id not in (
            select max(id) from design_docs where status in ('queued', 'running') group by board_id
          )
      `)
      await db.rawQuery(
        `create unique index if not exists design_docs_board_version_unique on design_docs (board_id, version)`
      )
      await db.rawQuery(
        `create unique index if not exists design_docs_one_active_per_board on design_docs (board_id) where status in ('queued', 'running')`
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.rawQuery('drop index if exists design_docs_one_active_per_board')
      await db.rawQuery('drop index if exists design_docs_board_version_unique')
    })
  }
}
