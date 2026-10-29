import './telemetry/register';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './common/config/env';

async function bootstrap() {
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, {
      bufferLogs: true,
    }),
  );

  const server = app.getHttpServer();
  server.requestTimeout = 30_000;
  // Longer than the load balancer's idle timeout (ALB default: 60 s) so the balancer closes idle connections first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await app.listen(
    app
      .get<ConfigService<Env, true>>(ConfigService)
      .get('PORT', { infer: true }),
  );
}

void bootstrap();
