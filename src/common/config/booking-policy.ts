import { Inject, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env';

/** The booking settings as one typed object, so services and tests never read ConfigService for them. */
export interface BookingPolicy {
  readonly slotGridMinutes: number;
  readonly minLeadMinutes: number;
  readonly horizonDays: number;
}

export const BOOKING_POLICY = Symbol('BOOKING_POLICY');
export const InjectBookingPolicy = () => Inject(BOOKING_POLICY);

export const bookingPolicyProvider: Provider<BookingPolicy> = {
  provide: BOOKING_POLICY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): BookingPolicy => ({
    slotGridMinutes: config.get('BOOKING_SLOT_GRID_MINUTES', { infer: true }),
    minLeadMinutes: config.get('BOOKING_MIN_LEAD_MINUTES', { infer: true }),
    horizonDays: config.get('BOOKING_HORIZON_DAYS', { infer: true }),
  }),
};
