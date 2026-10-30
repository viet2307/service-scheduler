import { createDatabase } from './database';
import { seedDemoData } from './seeder';

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set');

  const db = createDatabase({ connectionString, poolMax: 1 });
  try {
    await seedDemoData(db);
    console.log('Demo data seeded');
  } finally {
    await db.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
