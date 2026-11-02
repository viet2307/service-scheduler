import {
  isOnGrid,
  localDateOf,
  localDayWindow,
  OpeningHours,
  openingIntervals,
} from './calendar';
import { contains, MINUTE } from './interval';

const DAY = 24 * 60 * MINUTE;

/** The settings the booking rules read. */
export interface BookingRulesPolicy {
  readonly slotGridMinutes: number;
  readonly minLeadMinutes: number;
  readonly horizonDays: number;
}

export enum RuleViolation {
  OFF_GRID = 'OFF_GRID',
  TOO_SOON = 'TOO_SOON',
  BEYOND_HORIZON = 'BEYOND_HORIZON',
  OUTSIDE_OPENING_HOURS = 'OUTSIDE_OPENING_HOURS',
}

/** The first and last bookable start, both inclusive. Availability and booking both use it, so they agree. */
export const bookableStartRange = (
  now: number,
  policy: Pick<BookingRulesPolicy, 'minLeadMinutes' | 'horizonDays'>,
) => ({
  earliestStart: now + policy.minLeadMinutes * MINUTE,
  latestStart: now + policy.horizonDays * DAY,
});

export interface BookingRequest {
  readonly start: number;
  readonly durationMinutes: number;
  readonly now: number;
  readonly zone: string;
  readonly openingHours: readonly OpeningHours[];
  readonly policy: BookingRulesPolicy;
}

/**
 * Every rule the requested slot breaks, in a fixed order; empty when it may be booked.
 * Whether a technician and a bay are free is decided separately, by `freeResourcesAt`.
 */
export function checkBookingRules(request: BookingRequest): RuleViolation[] {
  const { start, zone, policy } = request;
  const slot = { start, end: start + request.durationMinutes * MINUTE };
  const { earliestStart, latestStart } = bookableStartRange(
    request.now,
    policy,
  );
  // Opening hours of the start's local day only, so a slot that crosses local midnight never fits.
  const opening = openingIntervals(
    request.openingHours,
    zone,
    localDayWindow(localDateOf(start, zone), zone),
  );

  const violations: RuleViolation[] = [];
  if (!isOnGrid(start, zone, policy.slotGridMinutes))
    violations.push(RuleViolation.OFF_GRID);
  if (start < earliestStart) violations.push(RuleViolation.TOO_SOON);
  if (start > latestStart) violations.push(RuleViolation.BEYOND_HORIZON);
  if (!contains(opening, slot))
    violations.push(RuleViolation.OUTSIDE_OPENING_HOURS);
  return violations;
}
