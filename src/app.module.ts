import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { BookingModule } from './booking/booking.module';
import { CommonModule } from './common/common.module';
import { validateEnv } from './common/config/env';
import { ProblemDetailsFilter } from './common/errors';
import { createLoggerParams } from './common/logger';
import { createValidationPipe } from './common/validation';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './persistence/database.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createLoggerParams,
    }),
    CommonModule,
    DatabaseModule,
    TelemetryModule,
    HealthModule,
    ReferenceDataModule,
    BookingModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
