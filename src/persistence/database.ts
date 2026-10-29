import { Inject, Logger } from '@nestjs/common';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './database.types';

export const KYSELY = Symbol('KYSELY');
export const InjectKysely = () => Inject(KYSELY);

export interface DatabaseOptions {
  connectionString: string;
  poolMax?: number;
  statementTimeoutMs?: number;
}

const logger = new Logger('Database');

export function createDatabase(options: DatabaseOptions): Kysely<DB> {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
    statement_timeout: options.statementTimeoutMs,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'service-scheduler',
  });
  // An idle client whose connection drops (failover, restart) emits here; without a listener the process crashes.
  pool.on('error', (error) =>
    logger.warn(`Idle database connection failed: ${error.message}`),
  );

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}
