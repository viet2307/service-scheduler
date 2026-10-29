import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createDatabase } from '@/persistence/database';
import { createMigrator } from '@/persistence/migrator';

/** Creates an empty database in the shared test container and returns its connection string. */
export async function createTestDatabase(): Promise<string> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl)
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set; run through the jest global setup',
    );

  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Like createTestDatabase, with every migration applied. */
export async function createMigratedTestDatabase(): Promise<string> {
  const url = await createTestDatabase();
  const db = createDatabase({ connectionString: url, poolMax: 1 });
  try {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw new Error('Migration failed', { cause: error });
  } finally {
    await db.destroy();
  }
  return url;
}
