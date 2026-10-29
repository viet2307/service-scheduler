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

// Ports of docs/evidence O1–O3: why AGENTS.md rule 1 says every ON CONFLICT names its target.
describe('ON CONFLICT and the overlap constraints', () => {
  let db: Kysely<DB>;
  const overlapping = () =>
    appointment({
      bayId: scenario.bayIds[1],
      vehicleId: scenario.vehicleIds[1],
      startAt: at('09:30'),
      endAt: at('10:30'),
    });

  const count = async () =>
    Number(
      (
        await db
          .selectFrom('appointment')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow()
      ).count,
    );

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
    await createScenario(db);
  });

  beforeEach(async () => {
    await sql`truncate appointment`.execute(db);
    await db
      .insertInto('appointment')
      .values(appointment({ idempotencyKey: 'original' }))
      .execute();
  });

  afterAll(() => db.destroy());

  it('O1 without a target, silently skips a double booking (the banned form)', async () => {
    const result = await db
      .insertInto('appointment')
      .values(overlapping())
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();

    expect(result.numInsertedOrUpdatedRows).toBe(0n);
    expect(await count()).toBe(1);
  });

  it('O2 with the idempotency_key target, still rejects a double booking', async () => {
    await expect(
      db
        .insertInto('appointment')
        .values(overlapping())
        .onConflict((oc) => oc.column('idempotencyKey').doNothing())
        .execute(),
    ).rejects.toMatchObject({
      code: PgErrorCode.EXCLUSION_VIOLATION,
      constraint: 'appointment_no_technician_overlap',
    });
  });

  it('O3 skips a replay with the same key and leaves the original untouched', async () => {
    const before = await db
      .selectFrom('appointment')
      .selectAll()
      .executeTakeFirstOrThrow();

    const replay = await db
      .insertInto('appointment')
      .values(
        appointment({
          idempotencyKey: 'original',
          requestFingerprint: 'other',
        }),
      )
      .onConflict((oc) => oc.column('idempotencyKey').doNothing())
      .returningAll()
      .executeTakeFirst();

    expect(replay).toBeUndefined();
    expect(await db.selectFrom('appointment').selectAll().execute()).toEqual([
      before,
    ]);
  });
});
