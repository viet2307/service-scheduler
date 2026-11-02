import { NodeEnv, validateEnv } from '@/common/config/env';

const DATABASE_URL = 'postgres://scheduler:scheduler@localhost:5432/scheduler';

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv({ DATABASE_URL })).toMatchObject({
      NODE_ENV: NodeEnv.Development,
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      DATABASE_POOL_MAX: 10,
      DATABASE_STATEMENT_TIMEOUT_MS: 5000,
      SWAGGER_ENABLED: true,
      BOOKING_SLOT_GRID_MINUTES: 15,
      BOOKING_MIN_LEAD_MINUTES: 30,
      BOOKING_HORIZON_DAYS: 90,
    });
  });

  it('coerces strings from the environment', () => {
    expect(
      validateEnv({
        DATABASE_URL,
        PORT: '8080',
        LOG_PRETTY: 'true',
        SWAGGER_ENABLED: 'false',
      }),
    ).toMatchObject({ PORT: 8080, LOG_PRETTY: true, SWAGGER_ENABLED: false });
  });

  it('lists every invalid variable', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://x', PORT: '0', LOG_LEVEL: 'loud' }),
    ).toThrow(
      /DATABASE_URL[\s\S]*PORT[\s\S]*LOG_LEVEL|PORT[\s\S]*LOG_LEVEL[\s\S]*DATABASE_URL/,
    );
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['BOOKING_SLOT_GRID_MINUTES', '7'],
    ['BOOKING_SLOT_GRID_MINUTES', '90'],
    ['BOOKING_SLOT_GRID_MINUTES', '7.5'],
    ['BOOKING_MIN_LEAD_MINUTES', '-1'],
    ['BOOKING_HORIZON_DAYS', '0'],
    ['BOOKING_HORIZON_DAYS', '366'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => validateEnv({ DATABASE_URL, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it('accepts a grid that divides the hour', () => {
    expect(
      validateEnv({ DATABASE_URL, BOOKING_SLOT_GRID_MINUTES: '20' }),
    ).toMatchObject({ BOOKING_SLOT_GRID_MINUTES: 20 });
  });
});
