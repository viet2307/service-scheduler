import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { createMigrator } from '@/persistence/migrator';

@Injectable()
export class DatabaseHealthIndicator {
  private migrationsApplied = false;

  constructor(
    private readonly indicator: HealthIndicatorService,
    @InjectKysely() private readonly db: Kysely<DB>,
  ) {}

  async check(key = 'database') {
    const health = this.indicator.check(key);
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      return health.down({ message: 'Database is unreachable' });
    }

    const pending = await this.pendingMigrations();
    return pending.length
      ? health.down({ pendingMigrations: pending })
      : health.up();
  }

  private async pendingMigrations(): Promise<string[]> {
    if (this.migrationsApplied) return [];
    const migrations = await createMigrator(this.db).getMigrations();
    const pending = migrations.filter((m) => !m.executedAt).map((m) => m.name);
    this.migrationsApplied = pending.length === 0;
    return pending;
  }
}
