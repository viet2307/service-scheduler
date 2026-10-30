import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { seedDemoData } from '@/persistence/seeder';
import { createMigratedTestDatabase } from '../../support/database';

const SEEDED_TABLES = [
  'skill',
  'bay_type',
  'service_type',
  'dealership',
  'technician',
  'technician_skill',
  'service_bay',
];

const id = (suffix: string) => `01a16194-0000-7000-8000-${suffix}`;

describe('seedDemoData', () => {
  let db: Kysely<DB>;

  const rowCounts = async () =>
    Object.fromEntries(
      await Promise.all(
        SEEDED_TABLES.map(async (table) => {
          const { rows } = await sql<{
            count: number;
          }>`select count(*)::int as count from ${sql.table(table)}`.execute(
            db,
          );
          return [table, rows[0].count] as const;
        }),
      ),
    );

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
  });

  afterAll(() => db.destroy());

  it('fills every seeded table and changes nothing when run again', async () => {
    await seedDemoData(db);
    const first = await rowCounts();
    await seedDemoData(db);

    expect(Object.values(first).every((count) => count > 0)).toBe(true);
    await expect(rowCounts()).resolves.toEqual(first);
  });

  it('contains the ids used by requests.http', async () => {
    const found = await Promise.all([
      db
        .selectFrom('dealership')
        .select('timezone')
        .where('id', '=', id('000000000001'))
        .executeTakeFirst(),
      db
        .selectFrom('serviceType')
        .select('code')
        .where('id', '=', id('0000000000a1'))
        .executeTakeFirst(),
    ]);
    expect(found).toEqual([
      { timezone: 'Asia/Ho_Chi_Minh' },
      { code: 'EV_BATTERY_CHECK' },
    ]);
  });

  it('refuses to run when NODE_ENV=production', async () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seedDemoData(db)).rejects.toThrow(/NODE_ENV=production/);
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });
});
