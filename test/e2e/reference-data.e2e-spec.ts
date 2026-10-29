import { createScenario, scenario } from '../support/fixtures';
import { createTestApp, TestApp } from './support/app';
import { expectMatchesOpenApi } from './support/openapi';

const EV_SERVICE_TYPE_ID = '01a16194-0000-7000-8000-0000000000a2';
const EMPTY_DEALERSHIP_ID = '01a16194-0000-7000-8000-000000000003';
const APPRENTICE_ID = '01a16194-0000-7000-8000-0000000000f4';
const UNKNOWN_ID = '01a16194-0000-7000-8000-0000000000ff';

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
    await t.db
      .insertInto('dealership')
      .values({
        id: EMPTY_DEALERSHIP_ID,
        name: 'Empty',
        timezone: 'Asia/Ho_Chi_Minh',
      })
      .execute();
    await t.db
      .insertInto('technician')
      .values({
        id: APPRENTICE_ID,
        dealershipId: scenario.dealershipId,
        displayName: 'Apprentice',
      })
      .execute();
    await t.db
      .insertInto('technicianSkill')
      .values({ technicianId: scenario.technicianIds[0], skillCode: 'EV_HV' })
      .execute();
    await t.db
      .updateTable('technician')
      .set({ isActive: false })
      .where('id', '=', scenario.technicianIds[2])
      .execute();
    await t.db
      .updateTable('serviceBay')
      .set({ isActive: false })
      .where('id', '=', scenario.bayIds[2])
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

  describe('GET /v1/dealerships/:id/technicians', () => {
    it("lists the dealership's technicians by name, with sorted skills and inactive ones flagged", async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/${scenario.dealershipId}/technicians`)
        .expect(200);

      expectMatchesOpenApi(res, 'DealershipResources_listTechnicians');
      const [first, second, third] = scenario.technicianIds;
      expect(res.body).toEqual([
        {
          id: APPRENTICE_ID,
          displayName: 'Apprentice',
          skills: [],
          isActive: true,
        },
        {
          id: first,
          displayName: 'Technician 1',
          skills: ['EV_HV', 'GENERAL'],
          isActive: true,
        },
        {
          id: second,
          displayName: 'Technician 2',
          skills: ['GENERAL'],
          isActive: true,
        },
        {
          id: third,
          displayName: 'Technician 3',
          skills: ['GENERAL'],
          isActive: false,
        },
      ]);
    });

    it('returns an empty list for a dealership without technicians', async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/${EMPTY_DEALERSHIP_ID}/technicians`)
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /v1/dealerships/:id/bays', () => {
    it("lists the dealership's bays by name, with inactive ones flagged", async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/${scenario.dealershipId}/bays`)
        .expect(200);

      expectMatchesOpenApi(res, 'DealershipResources_listBays');
      expect(res.body).toEqual(
        scenario.bayIds.map((id, i) => ({
          id,
          name: `Bay ${i + 1}`,
          bayType: 'LIFT',
          isActive: i !== 2,
        })),
      );
    });

    it('returns an empty list for a dealership without bays', async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/${EMPTY_DEALERSHIP_ID}/bays`)
        .expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe.each([
    ['technicians', 'DealershipResources_listTechnicians'],
    ['bays', 'DealershipResources_listBays'],
  ])('GET /v1/dealerships/:id/%s errors', (resource, operationId) => {
    it('answers 404 for an unknown dealership', async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/${UNKNOWN_ID}/${resource}`)
        .expect(404);

      expectMatchesOpenApi(res, operationId);
      expect(res.body).toMatchObject({
        code: 'NOT_FOUND',
        detail: `dealership ${UNKNOWN_ID} was not found`,
      });
    });

    it('answers 400 for a malformed dealership id', async () => {
      const res = await t
        .http()
        .get(`/v1/dealerships/not-a-uuid/${resource}`)
        .expect(400);

      expectMatchesOpenApi(res, operationId);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'id', messages: ['id must be a UUID'] }],
      });
    });
  });
});
