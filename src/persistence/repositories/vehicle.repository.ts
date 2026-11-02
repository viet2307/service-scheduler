import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../base.repository';

@Injectable()
export class VehicleRepository extends BaseRepository<'vehicle'> {
  protected readonly table = 'vehicle';
}
