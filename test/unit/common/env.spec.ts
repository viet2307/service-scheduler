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
});
