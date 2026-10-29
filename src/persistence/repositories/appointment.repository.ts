import { Injectable } from '@nestjs/common';
import { jsonBuildObject } from 'kysely/helpers/postgres';
import { BaseRepository } from '../base.repository';

@Injectable()
export class AppointmentRepository extends BaseRepository<'appointment'> {
  protected readonly table = 'appointment';

  /** The appointment with the vehicle, service type, technician and bay it references; cancelled ones included. */
  findDetailedById(id: string) {
    return this.db
      .selectFrom('appointment as a')
      .innerJoin('vehicle as v', 'v.id', 'a.vehicleId')
      .innerJoin('serviceType as st', 'st.id', 'a.serviceTypeId')
      .innerJoin('technician as t', 't.id', 'a.technicianId')
      .innerJoin('serviceBay as b', 'b.id', 'a.bayId')
      .select((eb) => [
        'a.id',
        'a.status',
        'a.dealershipId',
        'a.customerId',
        'a.startAt',
        'a.endAt',
        'a.createdAt',
        'a.cancelledAt',
        jsonBuildObject({ id: eb.ref('v.id'), vin: eb.ref('v.vin') }).as(
          'vehicle',
        ),
        jsonBuildObject({
          code: eb.ref('st.code'),
          durationMinutes: eb.ref('st.durationMinutes'),
        }).as('serviceType'),
        jsonBuildObject({
          id: eb.ref('t.id'),
          displayName: eb.ref('t.displayName'),
        }).as('technician'),
        jsonBuildObject({ id: eb.ref('b.id'), name: eb.ref('b.name') }).as(
          'bay',
        ),
      ])
      .where('a.id', '=', id)
      .executeTakeFirst();
  }
}
