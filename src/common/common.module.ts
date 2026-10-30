import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from './clock';
import { BOOKING_POLICY, bookingPolicyProvider } from './config/booking-policy';

@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }, bookingPolicyProvider],
  exports: [CLOCK, BOOKING_POLICY],
})
export class CommonModule {}
