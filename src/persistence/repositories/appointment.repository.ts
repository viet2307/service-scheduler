import { Injectable } from '@nestjs/common';
import { jsonBuildObject } from 'kysely/helpers/postgres';
import { BaseRepository } from '../base.repository';
import { overlapsRange, TimeWindow } from '../ranges';

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

  // The two busy queries repeat their constraint's dealership, range and status predicates,
  // so each can use that constraint's GiST index (evidence E1).

  /** Appointments that still block these technicians (any status but CANCELLED) and overlap the window. */
  async findBusyTechnicians(
    dealershipId: string,
    technicianIds: readonly string[],
    window: TimeWindow,
  ) {
    if (!technicianIds.length) return [];
    return this.db
      .selectFrom('appointment')
      .select(['technicianId', 'startAt', 'endAt'])
      .where('dealershipId', '=', dealershipId)
      .where('technicianId', 'in', technicianIds)
      .where(overlapsRange(window))
      .where('status', '<>', 'CANCELLED')
      .execute();
  }

  /** Appointments that still block these bays and overlap the window. */
  async findBusyBays(
    dealershipId: string,
    bayIds: readonly string[],
    window: TimeWindow,
  ) {
    if (!bayIds.length) return [];
    return this.db
      .selectFrom('appointment')
      .select(['bayId', 'startAt', 'endAt'])
      .where('dealershipId', '=', dealershipId)
      .where('bayId', 'in', bayIds)
      .where(overlapsRange(window))
      .where('status', '<>', 'CANCELLED')
      .execute();
  }
}
