import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { Clock, CLOCK } from '@/common/clock';
import { createDatabase, KYSELY } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import { createMigratedTestDatabase } from '../../support/database';

export interface AppOptions {
  /** Defaults to the shared DATABASE_URL. */
  databaseUrl?: string;
  controllers?: Type<unknown>[];
  /** Defaults to the system clock. */
  clock?: Clock;
}

export async function createApp({
  databaseUrl,
  controllers = [],
  clock,
}: AppOptions = {}): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers,
  });
  if (databaseUrl) {
    builder
      .overrideProvider(KYSELY)
      .useValue(createDatabase({ connectionString: databaseUrl }));
  }
  if (clock) builder.overrideProvider(CLOCK).useValue(clock);
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
  );
  await app.init();
  return app;
}

export interface TestApp {
  app: NestExpressApplication;
  /** The app's own pool, for fixtures. */
  db: Kysely<DB>;
  http: () => ReturnType<typeof request>;
}

/** Jest runs e2e files in parallel workers, so each suite gets its own migrated database. */
export async function createTestApp(
  options: Pick<AppOptions, 'clock'> = {},
): Promise<TestApp> {
  const app = await createApp({
    ...options,
    databaseUrl: await createMigratedTestDatabase(),
  });
  return {
    app,
    db: app.get<Kysely<DB>>(KYSELY),
    http: () => request(app.getHttpServer()),
  };
}
