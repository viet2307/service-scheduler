import { readdirSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { createMigrator, MIGRATIONS_FOLDER } from '@/persistence/migrator';
import { createTestDatabase } from '../../support/database';

describe('Migrator', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = createDatabase({ connectionString: await createTestDatabase() });
  });

  afterAll(() => db.destroy());

  it('applies every SQL migration to an empty database, in file order', async () => {
    const files = readdirSync(MIGRATIONS_FOLDER)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => f.replace(/\.sql$/, ''));

    const { error, results } = await createMigrator(db).migrateToLatest();

    expect(error).toBeUndefined();
    expect(results?.map((r) => [r.migrationName, r.status])).toEqual(
      files.map((name) => [name, 'Success']),
    );
  });

  it('installs btree_gist for the exclusion constraints', async () => {
    const { rows } = await sql<{ extname: string }>`
      select extname from pg_extension where extname = 'btree_gist'
    `.execute(db);
    expect(rows).toHaveLength(1);
  });

  it('is a no-op once the schema is up to date', async () => {
    const { error, results } = await createMigrator(db).migrateToLatest();
    expect(error).toBeUndefined();
    expect(results).toEqual([]);
  });
});
