import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseRepository } from '../base.repository';

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
}
