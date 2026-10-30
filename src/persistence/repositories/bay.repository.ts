import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class BayRepository extends BaseRepository<'serviceBay'> {
  protected readonly table = 'serviceBay';

  /** Active and inactive bays. */
  listByDealership(dealershipId: string) {
    return this.db
      .selectFrom('serviceBay')
      .select(['id', 'name', 'bayType', 'isActive'])
      .where('dealershipId', '=', dealershipId)
      .orderBy('name')
      .execute();
  }
}
