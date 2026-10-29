import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Kysely, Migration, MigrationProvider, Migrator, sql } from 'kysely';

export const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', 'migrations');

/** Forward-only: SQL files have no down migration. */
export class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private readonly folder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.folder))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const migrations = await Promise.all(
      files.map(async (file) => {
        const statements = await readFile(join(this.folder, file), 'utf8');
        const migration: Migration = {
          up: async (db) => {
            await sql.raw(statements).execute(db);
          },
        };
        return [basename(file, '.sql'), migration] as const;
      }),
    );
    return Object.fromEntries(migrations);
  }
}

export const createMigrator = <DB>(
  db: Kysely<DB>,
  folder = MIGRATIONS_FOLDER,
) => new Migrator({ db, provider: new SqlFileMigrationProvider(folder) });
