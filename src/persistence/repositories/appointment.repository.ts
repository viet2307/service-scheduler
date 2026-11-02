import { Injectable } from '@nestjs/common';
import { Insertable, sql } from 'kysely';
import { jsonBuildObject } from 'kysely/helpers/postgres';
import { BaseRepository } from '../base.repository';
import type { Appointment } from '../database.types';
import { overlapsRange, TimeWindow } from '../ranges';

/** A new booking; status, timestamps and id come from the column defaults. */
export type NewAppointment = Omit<
  Insertable<Appointment>,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'cancelledAt'
>;

@Injectable()
export class AppointmentRepository extends BaseRepository<'appointment'> {
  protected readonly table = 'appointment';

  findByIdempotencyKey(key: string) {
    return this.db
      .selectFrom('appointment')
      .select(['id', 'requestFingerprint'])
      .where('idempotencyKey', '=', key)
      .executeTakeFirst();
  }

  /**
   * The only appointment insert. Undefined when the key was already used: the caller replays.
   * The conflict target must stay named. Without it PostgreSQL also treats the exclusion
   * constraints as arbiters and silently skips a double booking instead of raising 23P01
   * (test/integration/invariants/on-conflict.int-spec.ts, AGENTS.md rule 1).
   */
  insertIfKeyIsNew(values: NewAppointment) {
    return this.db
      .insertInto('appointment')
      .values(values)
      .onConflict((oc) => oc.column('idempotencyKey').doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Queues bookings that share a technician, bay or vehicle until the transaction ends.
   * Without it, inserts that arrive together can each write their index entry and then wait for each
   * other until PostgreSQL aborts one with 40P01. Keys are taken in sorted order, so two bookings never
   * hold one lock each while waiting for the other's. The constraints stay the guarantee; this only orders writers.
   */
  async lockForBooking({
    technicianId,
    bayId,
    vehicleId,
  }: Pick<NewAppointment, 'technicianId' | 'bayId' | 'vehicleId'>) {
    // Outside a transaction the lock would be released as soon as the statement ends.
    if (!this.transactionHost.isActive)
      throw new Error('lockForBooking must run inside the booking transaction');
    const resources = [
      `technician:${technicianId}`,
      `bay:${bayId}`,
      `vehicle:${vehicleId}`,
    ];
    // The subquery sorts before the outer query locks (see the PostgreSQL docs on advisory locks and LIMIT).
    await sql`
      select pg_advisory_xact_lock(key)
      from (
        select hashtextextended(resource, 0) as key
        from unnest(${resources}::text[]) as resource
        order by key
      ) as ordered
    `.execute(this.db);
  }

  /** Repeats appointment_no_vehicle_overlap's range and status predicates, so its GiST index serves the check. */
  async hasVehicleOverlap(vehicleId: string, window: TimeWindow) {
    const row = await this.db
      .selectFrom('appointment')
      .select(sql<number>`1`.as('found'))
      .where('vehicleId', '=', vehicleId)
      .where(overlapsRange(window))
      .where('status', '<>', 'CANCELLED')
      .executeTakeFirst();
    return row !== undefined;
  }

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
