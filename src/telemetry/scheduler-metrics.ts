import { Injectable } from '@nestjs/common';
import { Histogram, metrics } from '@opentelemetry/api';

/**
 * Business metrics (SD §10.2). Dashboards and alerts depend on these names and labels.
 * `dealership_id` is never a label: thousands of values would explode the series count.
 */
@Injectable()
export class SchedulerMetrics {
  private readonly meter = metrics.getMeter('service-scheduler');

  private readonly slotsReturnedHistogram: Histogram =
    this.meter.createHistogram('scheduler.availability.slots_returned', {
      description: 'Bookable starts returned by one availability search',
      unit: '{slot}',
      advice: { explicitBucketBoundaries: [0, 1, 5, 10, 20, 40] },
    });

  /** A zero is demand the dealership cannot serve. */
  slotsReturned(count: number, serviceTypeCode: string): void {
    this.slotsReturnedHistogram.record(count, {
      service_type: serviceTypeCode,
    });
  }
}
