import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { createOpenApiDocument } from './openapi';

// Writes openapi.yaml without a database; the pool only connects on first query.
async function generate(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgres://openapi@localhost/openapi';
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../app.module.js');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableVersioning({ type: VersioningType.URI });
  const output = resolve(process.argv[2] ?? 'openapi.yaml');
  await writeFile(
    output,
    stringify(createOpenApiDocument(app), { aliasDuplicateObjects: false }),
  );
  await app.close();
  console.log(`OpenAPI document written to ${output}`);
}

generate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
