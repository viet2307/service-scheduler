import {
  Get,
  HttpException,
  HttpStatus,
  OnModuleDestroy,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Api } from '@/common/decorators';
import { AppError, ErrorCode } from '@/common/errors';
import { DatabaseHealthIndicator } from './database.health';

@Api({
  path: 'health',
  version: VERSION_NEUTRAL,
  problems: [HttpStatus.SERVICE_UNAVAILABLE],
})
export class HealthController implements OnModuleDestroy {
  private shuttingDown = false;

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('live')
  @ApiOkResponse({ description: 'The process is running' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck({ swaggerDocumentation: false })
  @ApiOkResponse({
    description: 'The database is reachable and every migration is applied',
  })
  async ready() {
    try {
      return await this.health.check([
        () =>
          this.shuttingDown
            ? this.indicator
                .check('lifecycle')
                .down({ message: 'Shutting down' })
            : this.indicator.check('lifecycle').up(),
        () => this.database.check(),
      ]);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const { details } = error.getResponse() as { details?: unknown };
      throw new AppError(
        ErrorCode.TEMPORARILY_UNAVAILABLE,
        'Service is not ready',
        {
          checks: details,
        },
      );
    }
  }

  // Runs before the HTTP server stops accepting requests, so the load balancer drains this instance first.
  onModuleDestroy(): void {
    this.shuttingDown = true;
  }
}
