import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { PgErrorCode } from '@/persistence/pg-errors';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

// Ports of docs/evidence T1–T8 plus I4, I5 and I8 (SD §3.2). Constraint names are written out
// on purpose: they are part of the error contract, so a rename must fail these tests.
describe('appointment invariants', () => {
  let db: Kysely<DB>;
  const [tech1, tech2] = scenario.technicianIds;
  const [, bay2] = scenario.bayIds;
  const [, vehicle2] = scenario.vehicleIds;

  const book = (overrides: Parameters<typeof appointment>[0] = {}) =>
    db
      .insertInto('appointment')
      .values(appointment(overrides))
      .returningAll()
      .executeTakeFirstOrThrow();

  const setStatus = (id: string, status: string, cancelledAt: Date | null) =>
    db
      .updateTable('appointment')
      .set({ status, cancelledAt })
      .where('id', '=', id)
      .execute();

  const violation = (code: string, constraint: string) => ({
    code,
    constraint,
  });

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    await createScenario(db);
  });

  beforeEach(() => sql`truncate appointment, technician_shift`.execute(db));

  afterAll(() => db.destroy());

  describe('overlap (I1–I3)', () => {
    it('T1 stores a booking with a UUIDv7 id and status CONFIRMED', async () => {
      const row = await book();

      expect(row.status).toBe('CONFIRMED');
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    });

    it('T2 rejects the same technician at an overlapping time', async () => {
      await book();

      await expect(
        book({
          bayId: bay2,
          vehicleId: vehicle2,
          startAt: at('09:30'),
          endAt: at('10:30'),
        }),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_technician_overlap',
        ),
      );
    });

    it('T3 rejects the same bay at an overlapping time', async () => {
      await book();

      await expect(
        book({
          technicianId: tech2,
          vehicleId: vehicle2,
          startAt: at('09:30'),
          endAt: at('10:30'),
        }),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_bay_overlap',
        ),
      );
    });

    it('T4 rejects the same vehicle at an overlapping time', async () => {
      await book();

      await expect(
        book({
          technicianId: tech2,
          bayId: bay2,
          startAt: at('09:30'),
          endAt: at('10:30'),
        }),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_vehicle_overlap',
        ),
      );
    });

    it('T5 allows back-to-back bookings because ranges are half-open', async () => {
      await book();
      await book({ startAt: at('10:00'), endAt: at('11:00') });

      const { count } = await db
        .selectFrom('appointment')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow();
      expect(Number(count)).toBe(2);
    });

    it('allows different technicians, bays and vehicles at the same time', async () => {
      await book();

      await expect(
        book({ technicianId: tech2, bayId: bay2, vehicleId: vehicle2 }),
      ).resolves.toBeDefined();
    });

    it('T6 frees the slot when an appointment is cancelled', async () => {
      const first = await book();
      await setStatus(first.id, 'CANCELLED', new Date());

      await expect(book({ vehicleId: vehicle2 })).resolves.toBeDefined();
    });

    it('T7 rejects un-cancelling into a slot that was re-booked (UPDATE is guarded too)', async () => {
      const first = await book();
      await setStatus(first.id, 'CANCELLED', new Date());
      await book({ bayId: bay2, vehicleId: vehicle2 });

      await expect(
        setStatus(first.id, 'CONFIRMED', null),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_technician_overlap',
        ),
      );
    });

    it.each(['COMPLETED', 'NO_SHOW'])(
      'keeps %s appointments blocking their time',
      async (status) => {
        const first = await book();
        await setStatus(first.id, status, null);

        await expect(
          book({ bayId: bay2, vehicleId: vehicle2 }),
        ).rejects.toMatchObject(
          violation(
            PgErrorCode.EXCLUSION_VIOLATION,
            'appointment_no_technician_overlap',
          ),
        );
      },
    );
  });

  describe('dealership ownership (I4)', () => {
    it("rejects another dealership's technician", async () => {
      await expect(
        book({ technicianId: scenario.otherDealershipTechnicianId }),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.FOREIGN_KEY_VIOLATION,
          'appointment_technician_fk',
        ),
      );
    });

    it("rejects another dealership's bay", async () => {
      await expect(
        book({ bayId: scenario.otherDealershipBayId }),
      ).rejects.toMatchObject(
        violation(PgErrorCode.FOREIGN_KEY_VIOLATION, 'appointment_bay_fk'),
      );
    });
  });

  describe('row consistency (I5)', () => {
    it.each([
      ['T8 ends before it starts', at('10:00'), at('09:00')],
      ['has zero length', at('09:00'), at('09:00')],
    ])('rejects an appointment that %s', async (_, startAt, endAt) => {
      await expect(book({ startAt, endAt })).rejects.toMatchObject(
        violation(PgErrorCode.CHECK_VIOLATION, 'appointment_interval_valid'),
      );
    });

    it.each([
      ['CANCELLED without cancelled_at', 'CANCELLED', null],
      ['CONFIRMED with cancelled_at', 'CONFIRMED', new Date()],
    ])('rejects %s', async (_, status, cancelledAt) => {
      await expect(book({ status, cancelledAt })).rejects.toMatchObject(
        violation(
          PgErrorCode.CHECK_VIOLATION,
          'appointment_cancelled_at_consistent',
        ),
      );
    });

    it('rejects an unknown status', async () => {
      await expect(book({ status: 'HELD' })).rejects.toMatchObject(
        violation(PgErrorCode.CHECK_VIOLATION, 'appointment_status_valid'),
      );
    });

    it('rejects a reused idempotency key when no conflict target absorbs it', async () => {
      await book({ idempotencyKey: 'same-key' });

      await expect(
        book({
          idempotencyKey: 'same-key',
          technicianId: tech2,
          bayId: bay2,
          vehicleId: vehicle2,
        }),
      ).rejects.toMatchObject(
        violation(
          PgErrorCode.UNIQUE_VIOLATION,
          'appointment_idempotency_key_uq',
        ),
      );
    });
  });

  describe('technician shifts (I8)', () => {
    const addShift = (technicianId: string, from: string, to: string) =>
      db
        .insertInto('technicianShift')
        .values({ technicianId, startAt: at(from), endAt: at(to) })
        .execute();

    it('rejects overlapping shifts for one technician', async () => {
      await addShift(tech1, '08:00', '12:00');

      await expect(addShift(tech1, '11:00', '17:00')).rejects.toMatchObject(
        violation(
          PgErrorCode.EXCLUSION_VIOLATION,
          'technician_shift_no_overlap',
        ),
      );
    });

    it('allows back-to-back shifts and the same hours for another technician', async () => {
      await addShift(tech1, '08:00', '12:00');

      await expect(addShift(tech1, '12:00', '17:00')).resolves.toBeDefined();
      await expect(addShift(tech2, '08:00', '12:00')).resolves.toBeDefined();
    });

    it('rejects a shift that ends before it starts', async () => {
      await expect(addShift(tech1, '12:00', '08:00')).rejects.toMatchObject(
        violation(
          PgErrorCode.CHECK_VIOLATION,
          'technician_shift_interval_valid',
        ),
      );
    });
  });
});
