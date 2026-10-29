import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { Env } from './common/config/env';
import { IDEMPOTENCY_KEY_HEADER } from './common/decorators';
import { createOpenApiDocument } from './openapi/openapi';

/** Shared by main.ts and the e2e tests. */
export function configureApp(
  app: NestExpressApplication,
): NestExpressApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();

  const origins = config.get('CORS_ALLOWED_ORIGINS', { infer: true });
  if (origins) {
    app.enableCors({
      origin: origins.split(',').map((origin) => origin.trim()),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        IDEMPOTENCY_KEY_HEADER,
        'X-Request-Id',
      ],
      exposedHeaders: [
        'Location',
        'Idempotent-Replayed',
        'Retry-After',
        'X-Request-Id',
      ],
    });
  }

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    SwaggerModule.setup('docs', app, () => createOpenApiDocument(app), {
      jsonDocumentUrl: 'docs/openapi.json',
      yamlDocumentUrl: 'docs/openapi.yaml',
    });
  }
  return app;
}
