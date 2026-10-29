import { createDatabase } from './database';
import { createMigrator } from './migrator';

// DATABASE_MIGRATION_URL lets migrations run as a DDL-capable role while the API connects with a DML-only one.
async function migrate(): Promise<void> {
  const connectionString =
    process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set');

  const db = createDatabase({ connectionString, poolMax: 1 });
  try {
    const { error, results = [] } = await createMigrator(db).migrateToLatest();
    for (const { migrationName, status } of results) {
      console.log(`${status}: ${migrationName}`);
    }
    if (error) throw new Error('Migration failed', { cause: error });
    if (!results.length) console.log('Database schema is up to date');
  } finally {
    await db.destroy();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
