import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import type { Env } from '@/common/config/env';
import { createDatabase, InjectKysely, KYSELY } from './database';
import type { DB } from './database.types';
import { TransactionHost } from './transaction-host';

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createDatabase({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
          statementTimeoutMs: config.get('DATABASE_STATEMENT_TIMEOUT_MS', {
            infer: true,
          }),
        }),
    },
    TransactionHost,
  ],
  exports: [KYSELY, TransactionHost],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@InjectKysely() private readonly db: Kysely<DB>) {}

  onApplicationShutdown(): Promise<void> {
    return this.db.destroy();
  }
}
