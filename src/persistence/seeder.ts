import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Kysely, sql } from 'kysely';

export const DEMO_SEED_FILE = resolve(
  __dirname,
  '..',
  '..',
  'seeds',
  'demo.sql',
);

/** Seeds are not migrations: demo rows must never reach production. */
export async function seedDemoData<DB>(
  db: Kysely<DB>,
  file = DEMO_SEED_FILE,
): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed demo data when NODE_ENV=production');

  const statements = await readFile(file, 'utf8');
  await db.transaction().execute(async (trx) => {
    await sql.raw(statements).execute(trx);
  });
}
