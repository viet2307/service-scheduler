import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import {
  isPgError,
  isTransientDatabaseError,
  PgErrorCode,
} from '@/persistence/pg-errors';
import { TransactionHost } from '@/persistence/transaction-host';
import { Transactional } from '@/persistence/transactional.decorator';
import { createTestDatabase } from '../../support/database';

describe('TransactionHost', () => {
  let db: Kysely<DB>;
  let host: TransactionHost;

  const insert = (name: string) =>
    sql`insert into ledger (name) values (${name})`.execute(host.executor);
  const names = async () =>
    (
      await sql<{
        name: string;
      }>`select name from ledger order by name`.execute(db)
    ).rows.map((r) => r.name);
  const setting = async (name: string) =>
    (
      await sql<{
        value: string;
      }>`select current_setting(${name}) as value`.execute(host.executor)
    ).rows[0].value;

  class LedgerService {
    @Transactional()
    async recordTwiceThenFail(): Promise<void> {
      await insert('first');
      await insert('second');
      throw new Error('rollback');
    }
  }

  beforeAll(async () => {
    db = createDatabase({ connectionString: await createTestDatabase() });
    await sql`create table ledger (name text primary key)`.execute(db);
    host = new TransactionHost(db);
  });

  beforeEach(() => sql`truncate ledger`.execute(db));

  afterAll(() => db.destroy());

  it('commits when the callback resolves', async () => {
    await host.run(async () => {
      expect(host.isActive).toBe(true);
      await insert('a');
    });

    expect(host.isActive).toBe(false);
    await expect(names()).resolves.toEqual(['a']);
  });

  it('rolls back everything when the callback throws', async () => {
    await expect(
      host.run(async () => {
        await insert('a');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(names()).resolves.toEqual([]);
  });

  it('joins the active transaction instead of nesting one', async () => {
    await expect(
      host.run(async () => {
        await insert('outer');
        await host.run(() => insert('inner'));
        throw new Error('rollback both');
      }),
    ).rejects.toThrow('rollback both');

    await expect(names()).resolves.toEqual([]);
  });

  it('wraps @Transactional methods', async () => {
    await expect(new LedgerService().recordTwiceThenFail()).rejects.toThrow(
      'rollback',
    );
    await expect(names()).resolves.toEqual([]);
  });

  it('scopes lock_timeout to the transaction', async () => {
    await host.run(
      async () => expect(await setting('lock_timeout')).toBe('2s'),
      {
        lockTimeoutMs: 2000,
      },
    );
    await expect(setting('lock_timeout')).resolves.toBe('0');
  });

  it('fails fast with a transient 55P03 when a competing transaction holds the lock', async () => {
    await insert('contended');
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));

    const holder = db.transaction().execute(async (trx) => {
      await sql`select * from ledger where name = 'contended' for update`.execute(
        trx,
      );
      locked();
      await held;
    });
    await lockTaken;

    const startedAt = Date.now();
    const error = await host
      .run(
        () =>
          sql`select * from ledger where name = 'contended' for update`.execute(
            host.executor,
          ),
        {
          lockTimeoutMs: 200,
        },
      )
      .catch((e: unknown) => e);

    release();
    await holder;
    expect(isPgError(error, PgErrorCode.LOCK_NOT_AVAILABLE)).toBe(true);
    expect(isTransientDatabaseError(error)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});
