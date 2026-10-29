import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { POSTGRES_IMAGE, setContainer } from './postgres';

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  setContainer(container);
  process.env.TEST_DATABASE_ADMIN_URL = container.getConnectionUri();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';
}
