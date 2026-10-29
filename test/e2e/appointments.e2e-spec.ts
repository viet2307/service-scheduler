import { appointment, at, createScenario, scenario } from '../support/fixtures';
import { createTestApp, TestApp } from './support/app';
import { expectMatchesOpenApi } from './support/openapi';

const CONFIRMED_ID = '01a16194-0000-7000-8000-0000000000d1';
const CANCELLED_ID = '01a16194-0000-7000-8000-0000000000d2';
const UNKNOWN_ID = '01a16194-0000-7000-8000-0000000000ff';

describe('Appointments (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await createScenario(t.db);
    await t.db
      .insertInto('appointment')
      .values([
        appointment({ id: CONFIRMED_ID }),
        appointment({
          id: CANCELLED_ID,
          vehicleId: scenario.vehicleIds[1],
          technicianId: scenario.technicianIds[1],
          bayId: scenario.bayIds[1],
          startAt: at('11:00'),
          endAt: at('12:00'),
          status: 'CANCELLED',
          cancelledAt: at('08:00'),
        }),
      ])
      .execute();
  });

  afterAll(() => t.app.close());

  describe('GET /v1/appointments/:id', () => {
    it('returns the appointment with its vehicle, service type, technician and bay', async () => {
      const res = await t
        .http()
        .get(`/v1/appointments/${CONFIRMED_ID}`)
        .expect(200);

      expectMatchesOpenApi(res, 'Appointments_get');
      expect(res.body).toEqual({
        id: CONFIRMED_ID,
        status: 'CONFIRMED',
        dealershipId: scenario.dealershipId,
        customerId: scenario.customerId,
        vehicle: { id: scenario.vehicleIds[0], vin: 'WVWZZZ1KZAW000001' },
        serviceType: { code: 'OIL_SERVICE', durationMinutes: 60 },
        technician: {
          id: scenario.technicianIds[0],
          displayName: 'Technician 1',
        },
        bay: { id: scenario.bayIds[0], name: 'Bay 1' },
        startAt: '2026-11-02T09:00:00.000Z',
        endAt: '2026-11-02T10:00:00.000Z',
        createdAt: expect.any(String),
        cancelledAt: null,
      });
    });

    it('returns a cancelled appointment with its cancellation time', async () => {
      const res = await t
        .http()
        .get(`/v1/appointments/${CANCELLED_ID}`)
        .expect(200);

      expectMatchesOpenApi(res, 'Appointments_get');
      expect(res.body).toMatchObject({
        id: CANCELLED_ID,
        status: 'CANCELLED',
        startAt: '2026-11-02T11:00:00.000Z',
        cancelledAt: '2026-11-02T08:00:00.000Z',
      });
    });

    it('answers 404 for an unknown appointment', async () => {
      const res = await t
        .http()
        .get(`/v1/appointments/${UNKNOWN_ID}`)
        .expect(404);

      expectMatchesOpenApi(res, 'Appointments_get');
      expect(res.body).toMatchObject({
        code: 'NOT_FOUND',
        detail: `appointment ${UNKNOWN_ID} was not found`,
      });
    });

    it('answers 400 for a malformed id', async () => {
      const res = await t.http().get('/v1/appointments/not-a-uuid').expect(400);

      expectMatchesOpenApi(res, 'Appointments_get');
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });
});
