import { randomUUID } from 'node:crypto';
import type { Insertable, Kysely } from 'kysely';
import type { DB } from '@/persistence/database.types';

const id = (suffix: string) =>
  `01a16194-0000-7000-8000-${suffix.padStart(12, '0')}`;

/** Fixed ids, shaped like the SD §7 examples, so a failing assertion points at a recognisable row. */
export const scenario = {
  dealershipId: id('1'),
  otherDealershipId: id('2'),
  serviceTypeId: id('a1'),
  customerId: id('c1'),
  vehicleIds: [id('e1'), id('e2'), id('e3')],
  technicianIds: [id('f1'), id('f2'), id('f3')],
  bayIds: [id('b1'), id('b2'), id('b3')],
  otherDealershipTechnicianId: id('f9'),
  otherDealershipBayId: id('b9'),
} as const;

export type Scenario = typeof scenario;

/** Every fixture booking happens on Monday 2 November 2026 (UTC). */
export const at = (time: string): Date => new Date(`2026-11-02T${time}:00Z`);

export async function createScenario(db: Kysely<DB>): Promise<Scenario> {
  const s = scenario;
  await db
    .insertInto('skill')
    .values([
      { code: 'GENERAL', description: 'General servicing' },
      { code: 'EV_HV', description: 'High-voltage EV work' },
    ])
    .execute();
  await db
    .insertInto('bayType')
    .values([
      { code: 'LIFT', description: 'Two-post lift' },
      { code: 'EV_HV', description: 'Insulated high-voltage bay' },
    ])
    .execute();
  await db
    .insertInto('serviceType')
    .values({
      id: s.serviceTypeId,
      code: 'OIL_SERVICE',
      name: 'Oil service',
      durationMinutes: 60,
      requiredSkill: 'GENERAL',
      requiredBayType: 'LIFT',
    })
    .execute();
  await db
    .insertInto('dealership')
    .values([
      { id: s.dealershipId, name: 'Saigon', timezone: 'Asia/Ho_Chi_Minh' },
      { id: s.otherDealershipId, name: 'London', timezone: 'Europe/London' },
    ])
    .execute();
  await db
    .insertInto('dealershipOpeningHours')
    .values(
      [1, 2, 3, 4, 5, 6].map((isoWeekday) => ({
        dealershipId: s.dealershipId,
        isoWeekday,
        opensAt: '08:00',
        closesAt: '17:30',
      })),
    )
    .execute();
  await db
    .insertInto('technician')
    .values([
      ...s.technicianIds.map((technicianId, i) => ({
        id: technicianId,
        dealershipId: s.dealershipId,
        displayName: `Technician ${i + 1}`,
      })),
      {
        id: s.otherDealershipTechnicianId,
        dealershipId: s.otherDealershipId,
        displayName: 'London technician',
      },
    ])
    .execute();
  await db
    .insertInto('technicianSkill')
    .values(
      s.technicianIds.map((technicianId) => ({
        technicianId,
        skillCode: 'GENERAL',
      })),
    )
    .execute();
  await db
    .insertInto('serviceBay')
    .values([
      ...s.bayIds.map((bayId, i) => ({
        id: bayId,
        dealershipId: s.dealershipId,
        name: `Bay ${i + 1}`,
        bayType: 'LIFT',
      })),
      {
        id: s.otherDealershipBayId,
        dealershipId: s.otherDealershipId,
        name: 'Bay 1',
        bayType: 'LIFT',
      },
    ])
    .execute();
  await db
    .insertInto('customer')
    .values({ id: s.customerId, fullName: 'Test Customer' })
    .execute();
  await db
    .insertInto('vehicle')
    .values(
      s.vehicleIds.map((vehicleId, i) => ({
        id: vehicleId,
        customerId: s.customerId,
        vin: `WVWZZZ1KZAW00000${i + 1}`,
        make: 'Volkswagen',
        model: 'ID.3',
      })),
    )
    .execute();
  return s;
}

/** Technician 1, bay 1 and vehicle 1 from 09:00 to 10:00 unless overridden. */
export const appointment = (
  overrides: Partial<Insertable<DB['appointment']>> = {},
): Insertable<DB['appointment']> => ({
  dealershipId: scenario.dealershipId,
  customerId: scenario.customerId,
  vehicleId: scenario.vehicleIds[0],
  serviceTypeId: scenario.serviceTypeId,
  technicianId: scenario.technicianIds[0],
  bayId: scenario.bayIds[0],
  startAt: at('09:00'),
  endAt: at('10:00'),
  idempotencyKey: randomUUID(),
  requestFingerprint: 'fixture',
  ...overrides,
});
