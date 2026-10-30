import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CLOCK, SystemClock } from '@/common/clock';
import { CommonModule } from '@/common/common.module';
import { BOOKING_POLICY } from '@/common/config/booking-policy';
import { validateEnv } from '@/common/config/env';

const compile = (raw: Record<string, unknown>) =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: () => validateEnv(raw),
      }),
      CommonModule,
    ],
  }).compile();

describe('CommonModule', () => {
  const DATABASE_URL = 'postgres://localhost/scheduler';

  it('builds the booking policy from the environment', async () => {
    const moduleRef = await compile({
      DATABASE_URL,
      BOOKING_SLOT_GRID_MINUTES: '30',
      BOOKING_HORIZON_DAYS: '14',
    });

    expect(moduleRef.get(BOOKING_POLICY)).toEqual({
      slotGridMinutes: 30,
      minLeadMinutes: 30,
      horizonDays: 14,
    });
  });

  it('provides the system clock', async () => {
    const clock = (await compile({ DATABASE_URL })).get<SystemClock>(CLOCK);
    const before = Date.now();

    expect(clock).toBeInstanceOf(SystemClock);
    expect(clock.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});
