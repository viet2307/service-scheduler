import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/persistence/repositories';
import { TelemetryModule } from '@/telemetry/telemetry.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [RepositoriesModule, TelemetryModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
