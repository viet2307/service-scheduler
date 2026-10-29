import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { IsolationLevel, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from './database';
import type { DB } from './database.types';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  /** Max wait for a competing row lock before failing with 55P03. */
  lockTimeoutMs?: number;
}

/** Repositories join the current transaction through AsyncLocalStorage. */
@Injectable()
export class TransactionHost {
  private static current?: TransactionHost;
  private readonly storage = new AsyncLocalStorage<Transaction<DB>>();

  constructor(@InjectKysely() private readonly db: Kysely<DB>) {
    TransactionHost.current = this;
  }

  static get instance(): TransactionHost {
    if (!TransactionHost.current) {
      throw new Error(
        'TransactionHost is not initialised; import DatabaseModule',
      );
    }
    return TransactionHost.current;
  }

  get executor(): Kysely<DB> {
    return this.storage.getStore() ?? this.db;
  }

  get isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /** Runs `fn` in a new transaction, or joins the active one (its options then apply). */
  run<T>(fn: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    if (this.isActive) return fn();

    const builder = options.isolationLevel
      ? this.db.transaction().setIsolationLevel(options.isolationLevel)
      : this.db.transaction();

    return builder.execute(async (trx) => {
      if (options.lockTimeoutMs !== undefined) {
        await sql`select set_config('lock_timeout', ${`${options.lockTimeoutMs}ms`}, true)`.execute(
          trx,
        );
      }
      return this.storage.run(trx, fn);
    });
  }
}
