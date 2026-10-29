import { setTimeout as sleep } from 'node:timers/promises';
import { Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { isTransientDatabaseError, PgErrorCode } from '@/persistence/pg-errors';
import { TransactionHost } from '@/persistence/transaction-host';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

/** Holds a transaction open after inserting `values`, until released. */
function holdInsert(db: Kysely<DB>, values: ReturnType<typeof appointment>) {
  let release!: (outcome: 'commit' | 'rollback') => void;
  const decision = new Promise<'commit' | 'rollback'>(
    (resolve) => (release = resolve),
  );
  let signalInserted!: () => void;
  const inserted = new Promise<void>((resolve) => (signalInserted = resolve));

  const done = db.transaction().execute(async (trx) => {
    await trx.insertInto('appointment').values(values).execute();
    signalInserted();
    if ((await decision) === 'rollback')
      throw new Error('rolled back on purpose');
  });
  return {
    inserted,
    done,
    commit: () => release('commit'),
    rollback: () => release('rollback'),
  };
}

function watch(promise: Promise<unknown>) {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

// Ports of docs/evidence Race B and L1: the guarantee under real parallel connections.
describe('concurrent bookings', () => {
  let db: Kysely<DB>;
  const competitor = () =>
    appointment({
      bayId: scenario.bayIds[1],
      vehicleId: scenario.vehicleIds[1],
      startAt: at('09:30'),
      endAt: at('10:30'),
    });

  const rows = () => db.selectFrom('appointment').selectAll().execute();

  beforeAll(async () => {
    const url = await createMigratedTestDatabase();
    // Each deadlock victim waits deadlock_timeout (1 s by default) and victims chain, so a
    // 20-way race could take ~20 s. Lowering it for this throwaway database keeps the suite fast.
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(
      `alter database "${new URL(url).pathname.slice(1)}" set deadlock_timeout = '100ms'`,
    );
    await admin.end();

    db = createDatabase({ connectionString: url, poolMax: 20 });
    await createScenario(db);
  });

  beforeEach(() => sql`truncate appointment`.execute(db));

  afterAll(() => db.destroy());

  it('Race B: the second booking waits for the first transaction, then fails when it commits', async () => {
    const holder = holdInsert(db, appointment());
    await holder.inserted;

    const contender = db
      .insertInto('appointment')
      .values(competitor())
      .execute();
    const state = watch(contender);
    await sleep(200);
    expect(state.settled).toBe(false);

    holder.commit();
    await holder.done;
    await expect(contender).rejects.toMatchObject({
      code: PgErrorCode.EXCLUSION_VIOLATION,
      constraint: 'appointment_no_technician_overlap',
    });
    expect(await rows()).toHaveLength(1);
  });

  it('lets the waiting booking through when the first transaction rolls back', async () => {
    const holder = holdInsert(db, appointment());
    await holder.inserted;

    const contender = db
      .insertInto('appointment')
      .values(competitor())
      .execute();
    holder.rollback();

    await expect(holder.done).rejects.toThrow('rolled back on purpose');
    await expect(contender).resolves.toBeDefined();
    expect(await rows()).toMatchObject([{ startAt: at('09:30') }]);
  });

  it('L1: a transaction lock timeout stops the wait with a retryable error', async () => {
    const holder = holdInsert(db, appointment());
    await holder.inserted;
    const host = new TransactionHost(db);

    const started = Date.now();
    const error: unknown = await host
      .run(
        () =>
          host.executor
            .insertInto('appointment')
            .values(competitor())
            .execute(),
        {
          lockTimeoutMs: 300,
        },
      )
      .catch((e: unknown) => e);
    const waited = Date.now() - started;

    holder.commit();
    await holder.done;
    expect(error).toMatchObject({ code: PgErrorCode.LOCK_NOT_AVAILABLE });
    expect(isTransientDatabaseError(error)).toBe(true);
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(await rows()).toHaveLength(1);
  });

  // Inserts that arrive together can each write their index entry before either checks for
  // conflicts; both then wait for each other and PostgreSQL aborts one with 40P01. Either way
  // exactly one booking survives, which is the invariant.
  it('stores exactly one of 20 simultaneous bookings for the same technician, bay, vehicle and time', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.insertInto('appointment').values(appointment()).execute(),
      ),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    for (const { reason } of rejected) {
      expect([
        PgErrorCode.EXCLUSION_VIOLATION,
        PgErrorCode.DEADLOCK_DETECTED,
      ]).toContain(reason.code);
    }
    expect(await rows()).toHaveLength(1);
  });
});
