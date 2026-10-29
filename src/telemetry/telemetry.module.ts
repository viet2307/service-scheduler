import { Module, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from './sdk';

@Module({})
export class TelemetryModule implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}
