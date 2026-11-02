import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

const RECONCILE = readFileSync(
  resolve(
    __dirname,
    '..',
    '..',
    '..',
    'scripts',
    'sql',
    'reconcile-overlaps.sql',
  ),
  'utf8',
);

const FIRST_ID = '01a16194-0000-7000-8000-0000000000d1';
const SECOND_ID = '01a16194-0000-7000-8000-0000000000d2';
const CANCELLED_ID = '01a16194-0000-7000-8000-0000000000d3';

describe('Overlap reconciliation query', () => {
  const databases: Kysely<DB>[] = [];

  const freshDatabase = async () => {
    const db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    databases.push(db);
    await createScenario(db);
    return db;
  };

  const reconcile = async (db: Kysely<DB>) =>
    (await sql.raw(RECONCILE).execute(db)).rows;

  afterAll(() => Promise.all(databases.map((db) => db.destroy())));

  it('finds nothing while the constraints hold, including back-to-back bookings', async () => {
    const db = await freshDatabase();
    await db
      .insertInto('appointment')
      .values([
        appointment(),
        appointment({ startAt: at('10:00'), endAt: at('11:00') }),
      ])
      .execute();

    expect(await reconcile(db)).toEqual([]);
  });

  it('reports each overlap on a technician, bay and vehicle once the constraints are gone', async () => {
    const db = await freshDatabase();
    // The drift the hourly check exists to catch, staged in a database used only by this test.
    await sql`
      alter table appointment
        drop constraint appointment_no_technician_overlap,
        drop constraint appointment_no_bay_overlap,
        drop constraint appointment_no_vehicle_overlap
    `.execute(db);
    await db
      .insertInto('appointment')
      .values([
        appointment({ id: FIRST_ID }),
        appointment({
          id: SECOND_ID,
          startAt: at('09:30'),
          endAt: at('10:30'),
        }),
        appointment({
          id: CANCELLED_ID,
          status: 'CANCELLED',
          cancelledAt: at('08:00'),
        }),
      ])
      .execute();

    const pair = { appointmentId: FIRST_ID, overlappingId: SECOND_ID };
    expect(await reconcile(db)).toEqual([
      { resource: 'bay', resourceId: scenario.bayIds[0], ...pair },
      {
        resource: 'technician',
        resourceId: scenario.technicianIds[0],
        ...pair,
      },
      { resource: 'vehicle', resourceId: scenario.vehicleIds[0], ...pair },
    ]);
  });
});
