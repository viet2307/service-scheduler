import { Kysely } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { seedDemoData } from '@/persistence/seeder';
import { createMigratedTestDatabase } from '../../support/database';

describe('seedDemoData', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = createDatabase({
      connectionString: await createMigratedTestDatabase(),
    });
  });

  afterAll(() => db.destroy());

  it('applies the demo seed and can run again', async () => {
    await seedDemoData(db);
    await seedDemoData(db);

    const serviceTypes = await db
      .selectFrom('serviceType')
      .select(['id', 'code'])
      .orderBy('id')
      .execute();
    expect(serviceTypes).toEqual([
      { id: '01a16194-0000-7000-8000-0000000000a1', code: 'EV_BATTERY_CHECK' },
      { id: '01a16194-0000-7000-8000-0000000000a2', code: 'OIL_SERVICE' },
      { id: '01a16194-0000-7000-8000-0000000000a3', code: 'WHEEL_ALIGNMENT' },
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
