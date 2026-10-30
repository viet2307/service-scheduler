import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class ServiceTypeRepository extends BaseRepository<'serviceType'> {
  protected readonly table = 'serviceType';

  list() {
    return this.db
      .selectFrom('serviceType')
      .selectAll()
      .orderBy('name')
      .orderBy('code')
      .execute();
  }
}
