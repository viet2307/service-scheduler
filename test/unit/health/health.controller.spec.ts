import { HealthController } from '@/health/health.controller';

describe('HealthController', () => {
  it('reports the process as live', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });
});
