import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class DealershipRepository extends BaseRepository<'dealership'> {
  protected readonly table = 'dealership';
}
