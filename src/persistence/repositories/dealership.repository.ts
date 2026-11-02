import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class DealershipRepository extends BaseRepository<'dealership'> {
  protected readonly table = 'dealership';

  /** One row per open weekday; a weekday without a row is closed. */
  getOpeningHours(dealershipId: string) {
    return this.db
      .selectFrom('dealershipOpeningHours')
      .select(['isoWeekday', 'opensAt', 'closesAt'])
      .where('dealershipId', '=', dealershipId)
      .orderBy('isoWeekday')
      .execute();
  }
}
