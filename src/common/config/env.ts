import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @Transform(toBoolean)
  @IsBoolean()
  LOG_PRETTY = false;

  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// connection string',
  })
  DATABASE_URL: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DATABASE_POOL_MAX = 10;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_STATEMENT_TIMEOUT_MS = 5000;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = true;

  @IsOptional()
  @IsString()
  CORS_ALLOWED_ORIGINS?: string;

  @IsUrl({ require_tld: false })
  PROBLEM_TYPE_BASE_URL = 'https://scheduler.example.com/problems';

  @IsString()
  OTEL_SERVICE_NAME = 'service-scheduler';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  SHUTDOWN_GRACE_PERIOD_MS = 5000;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env);
  if (errors.length) {
    const details = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
