import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class CustomerRepository extends BaseRepository<'customer'> {
  protected readonly table = 'customer';
}
