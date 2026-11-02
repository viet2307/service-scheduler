import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { BaseRepository } from '../base.repository';
import { overlapsRange, TimeWindow } from '../ranges';

@Injectable()
export class TechnicianRepository extends BaseRepository<'technician'> {
  protected readonly table = 'technician';

  /** Active and inactive technicians, each with their skill codes. */
  listByDealership(dealershipId: string) {
    return this.db
      .selectFrom('technician as t')
      .leftJoin('technicianSkill as ts', 'ts.technicianId', 't.id')
      .select((eb) => [
        't.id',
        't.displayName',
        't.isActive',
        eb.fn
          .coalesce(
            eb.fn
              .agg<string[]>('array_agg', ['ts.skillCode'])
              .orderBy('ts.skillCode')
              .filterWhere('ts.skillCode', 'is not', null),
            sql<string[]>`'{}'::text[]`,
          )
          .as('skills'),
      ])
      .where('t.dealershipId', '=', dealershipId)
      .groupBy('t.id')
      .orderBy('t.displayName')
      .orderBy('t.id')
      .execute();
  }

  /** Active technicians holding `skill`, how many other skills each holds, and their shifts overlapping the window. */
  async findQualified(dealershipId: string, skill: string, window: TimeWindow) {
    const rows = await this.db
      .selectFrom('technician as t')
      .innerJoin('technicianSkill as s', 's.technicianId', 't.id')
      .select((eb) => [
        't.id',
        sql<number>`count(*)::int - 1`.as('extraSkillCount'),
        jsonArrayFrom(
          eb
            .selectFrom('technicianShift as shift')
            .select(['shift.startAt', 'shift.endAt'])
            .whereRef('shift.technicianId', '=', 't.id')
            .where(overlapsRange(window))
            .orderBy('shift.startAt'),
        ).as('shifts'),
      ])
      .where('t.dealershipId', '=', dealershipId)
      .where('t.isActive', '=', true)
      .groupBy('t.id')
      .having(sql<boolean>`bool_or(${sql.ref('s.skillCode')} = ${skill})`)
      .orderBy('t.id')
      .execute();

    // json_agg renders timestamps as ISO strings.
    return rows.map((row) => ({
      ...row,
      shifts: row.shifts.map((shift) => ({
        startAt: new Date(shift.startAt),
        endAt: new Date(shift.endAt),
      })),
    }));
  }
}
