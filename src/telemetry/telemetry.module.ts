import { Module, OnApplicationShutdown } from '@nestjs/common';
import { SchedulerMetrics } from './scheduler-metrics';
import { shutdownTelemetry } from './sdk';

@Module({
  providers: [SchedulerMetrics],
  exports: [SchedulerMetrics],
})
export class TelemetryModule implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}
