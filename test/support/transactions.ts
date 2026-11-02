import type { Insertable, Kysely } from 'kysely';
import type { DB } from '@/persistence/database.types';

/** Holds a transaction open after inserting `values`, until released. */
export function holdInsert(
  db: Kysely<DB>,
  values: Insertable<DB['appointment']>,
) {
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
