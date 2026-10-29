import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import {
  classifyOverlap,
  missingConstraints,
} from '@/persistence/overlap-constraints';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

describe('overlap constraints', () => {
  let db: Kysely<DB>;

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('expected the insert to fail');
      },
      (error: unknown) => error,
    );

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    await createScenario(db);
    await db.insertInto('appointment').values(appointment()).execute();
  });

  afterAll(() => db.destroy());

  it('classifies real violations by resource and retry policy', async () => {
    const technician = await errorOf(
      db
        .insertInto('appointment')
        .values(
          appointment({
            bayId: scenario.bayIds[1],
            vehicleId: scenario.vehicleIds[1],
            startAt: at('09:30'),
            endAt: at('10:30'),
          }),
        )
        .execute(),
    );
    const vehicle = await errorOf(
      db
        .insertInto('appointment')
        .values(
          appointment({
            technicianId: scenario.technicianIds[1],
            bayId: scenario.bayIds[1],
          }),
        )
        .execute(),
    );

    expect(classifyOverlap(technician)).toMatchObject({
      resource: 'technician',
      onBookingConflict: 'retry',
    });
    expect(classifyOverlap(vehicle)).toMatchObject({
      resource: 'vehicle',
      onBookingConflict: 'reject',
    });
  });

  it('finds every constraint after the migrations', async () => {
    expect(await missingConstraints(db)).toEqual([]);
  });

  it('reports a constraint that a migration dropped', async () => {
    await sql`alter table appointment drop constraint appointment_no_bay_overlap`.execute(
      db,
    );

    expect(await missingConstraints(db)).toEqual([
      'appointment_no_bay_overlap',
    ]);
  });
});
