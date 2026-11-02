import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { PgErrorCode } from '@/persistence/pg-errors';
import { AppointmentRepository } from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

const window = (from: string, to: string) => ({ from: at(from), to: at(to) });

describe('Booking queries', () => {
  let db: Kysely<DB>;
  let appointments: AppointmentRepository;

  const count = () =>
    db
      .selectFrom('appointment')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
      .then(({ count }) => Number(count));

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    appointments = new AppointmentRepository(new TransactionHost(db));
    await createScenario(db);
  });

  beforeEach(() => sql`truncate appointment`.execute(db));

  afterAll(() => db.destroy());

  describe('insertIfKeyIsNew', () => {
    it('inserts a confirmed appointment and returns it', async () => {
      const row = await appointments.insertIfKeyIsNew(
        appointment({ idempotencyKey: 'k1', requestFingerprint: 'f1' }),
      );

      expect(row).toMatchObject({
        status: 'CONFIRMED',
        idempotencyKey: 'k1',
        requestFingerprint: 'f1',
        startAt: at('09:00'),
        cancelledAt: null,
      });
      expect(await count()).toBe(1);
    });

    it('returns undefined and inserts nothing when the key was already used', async () => {
      await appointments.insertIfKeyIsNew(
        appointment({ idempotencyKey: 'k1' }),
      );

      const replay = await appointments.insertIfKeyIsNew(
        appointment({
          idempotencyKey: 'k1',
          vehicleId: scenario.vehicleIds[1],
          startAt: at('13:00'),
          endAt: at('14:00'),
        }),
      );

      expect(replay).toBeUndefined();
      expect(await count()).toBe(1);
    });

    it('still raises 23P01 for an overlap with a new key', async () => {
      await appointments.insertIfKeyIsNew(appointment());

      await expect(
        appointments.insertIfKeyIsNew(
          appointment({
            bayId: scenario.bayIds[1],
            vehicleId: scenario.vehicleIds[1],
            startAt: at('09:30'),
            endAt: at('10:30'),
          }),
        ),
      ).rejects.toMatchObject({
        code: PgErrorCode.EXCLUSION_VIOLATION,
        constraint: 'appointment_no_technician_overlap',
      });
      expect(await count()).toBe(1);
    });
  });

  describe('findByIdempotencyKey', () => {
    it('returns the id and fingerprint stored with the key', async () => {
      const row = await appointments.insertIfKeyIsNew(
        appointment({ idempotencyKey: 'k1', requestFingerprint: 'f1' }),
      );

      expect(await appointments.findByIdempotencyKey('k1')).toEqual({
        id: row!.id,
        requestFingerprint: 'f1',
      });
      expect(await appointments.findByIdempotencyKey('k2')).toBeUndefined();
    });
  });

  describe('hasVehicleOverlap', () => {
    beforeEach(() =>
      db.insertInto('appointment').values(appointment()).execute(),
    );

    it.each([
      ['an overlapping window', window('09:30', '10:30'), true],
      ['a window ending at its start', window('08:00', '09:00'), false],
      ['a window starting at its end', window('10:00', '11:00'), false],
    ])('reports %s', async (_, range, expected) => {
      expect(
        await appointments.hasVehicleOverlap(scenario.vehicleIds[0], range),
      ).toBe(expected);
    });

    it('ignores other vehicles', async () => {
      expect(
        await appointments.hasVehicleOverlap(
          scenario.vehicleIds[1],
          window('09:00', '10:00'),
        ),
      ).toBe(false);
    });

    it('ignores cancelled appointments', async () => {
      await db
        .updateTable('appointment')
        .set({ status: 'CANCELLED', cancelledAt: at('08:00') })
        .execute();

      expect(
        await appointments.hasVehicleOverlap(
          scenario.vehicleIds[0],
          window('09:00', '10:00'),
        ),
      ).toBe(false);
    });
  });
});
