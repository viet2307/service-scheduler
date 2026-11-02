import type { Clock } from '@/common/clock';

/** Stays at the instant it is given, so lead-time and horizon rules do not depend on today's date. */
export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}
