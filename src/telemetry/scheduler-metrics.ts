import { Injectable } from '@nestjs/common';
import { Counter, Histogram, metrics } from '@opentelemetry/api';

/** One per booking request, so the counter sums to the total. */
export type BookingOutcome =
  | 'confirmed'
  | 'replayed'
  | 'slot_unavailable'
  | 'vehicle_conflict'
  | 'rule_violated'
  | 'not_found'
  | 'key_reused'
  | 'error';

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

  private readonly bookingOutcomeCounter: Counter = this.meter.createCounter(
    'scheduler.booking.outcome',
    {
      description: 'Booking requests by outcome',
      unit: '{request}',
    },
  );

  private readonly conflictRetryCounter: Counter = this.meter.createCounter(
    'scheduler.booking.conflict_retry',
    {
      description: 'Booking insert attempts lost to a concurrent booking',
      unit: '{attempt}',
    },
  );

  private readonly bookingAttemptsHistogram: Histogram =
    this.meter.createHistogram('scheduler.booking.attempts', {
      description: 'Insert attempts per booking that reached the insert',
      unit: '{attempt}',
      advice: { explicitBucketBoundaries: [1, 2, 3, 5, 10] },
    });

  /** A zero is demand the dealership cannot serve. */
  slotsReturned(count: number, serviceTypeCode: string): void {
    this.slotsReturnedHistogram.record(count, {
      service_type: serviceTypeCode,
    });
  }

  /** A rising slot_unavailable share means a capacity shortage, or a bug. */
  bookingOutcome(outcome: BookingOutcome, serviceTypeCode: string): void {
    this.bookingOutcomeCounter.add(1, {
      outcome,
      service_type: serviceTypeCode,
    });
  }

  /**
   * `resource` is technician, bay, or deadlock (a 40P01 names none). If it climbs, requests keep
   * ranking the same pair first, and a random tie-break among the top candidates would spread them out.
   */
  conflictRetry(resource: string): void {
    this.conflictRetryCounter.add(1, { resource });
  }

  bookingAttempts(attempts: number): void {
    this.bookingAttemptsHistogram.record(attempts);
  }
}
