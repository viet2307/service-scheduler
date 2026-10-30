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

  /** Active bays of `bayType`. */
  findCompatible(dealershipId: string, bayType: string) {
    return this.db
      .selectFrom('serviceBay')
      .select(['id', 'name'])
      .where('dealershipId', '=', dealershipId)
      .where('bayType', '=', bayType)
      .where('isActive', '=', true)
      .orderBy('name')
      .execute();
  }
}
