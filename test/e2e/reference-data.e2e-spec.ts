import { createScenario, scenario } from '../support/fixtures';
import { createTestApp, TestApp } from './support/app';
import { expectMatchesOpenApi } from './support/openapi';

const EV_SERVICE_TYPE_ID = '01a16194-0000-7000-8000-0000000000a2';

describe('Reference data (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await createScenario(t.db);
    await t.db
      .insertInto('serviceType')
      .values({
        id: EV_SERVICE_TYPE_ID,
        code: 'EV_BATTERY_CHECK',
        name: 'EV battery health check',
        durationMinutes: 90,
        requiredSkill: 'EV_HV',
        requiredBayType: 'EV_HV',
      })
      .execute();
  });

  afterAll(() => t.app.close());

  describe('GET /v1/service-types', () => {
    it('lists every service type by name', async () => {
      const res = await t.http().get('/v1/service-types').expect(200);

      expectMatchesOpenApi(res, 'ServiceTypes_list');
      expect(res.body).toEqual([
        {
          id: EV_SERVICE_TYPE_ID,
          code: 'EV_BATTERY_CHECK',
          name: 'EV battery health check',
          durationMinutes: 90,
          requiredSkill: 'EV_HV',
          requiredBayType: 'EV_HV',
        },
        {
          id: scenario.serviceTypeId,
          code: 'OIL_SERVICE',
          name: 'Oil service',
          durationMinutes: 60,
          requiredSkill: 'GENERAL',
          requiredBayType: 'LIFT',
        },
      ]);
    });
  });
});
