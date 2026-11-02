import { randomUUID } from 'node:crypto';
import { FixedClock } from '../support/clock';
import { appointment, at, createScenario, scenario } from '../support/fixtures';
import { holdInsert } from '../support/transactions';
import { createTestApp, TestApp } from './support/app';
import { expectMatchesOpenApi } from './support/openapi';

const CONFIRMED_ID = '01a16194-0000-7000-8000-0000000000d1';
const CANCELLED_ID = '01a16194-0000-7000-8000-0000000000d2';
const UNKNOWN_ID = '01a16194-0000-7000-8000-0000000000ff';

/** A fourth technician, so a slot can have a free technician but no free bay. */
const SPARE_TECHNICIAN_ID = '01a16194-0000-7000-8000-0000000000f4';
const SPARE_VEHICLE_ID = '01a16194-0000-7000-8000-0000000000e4';
const OTHER_CUSTOMER_ID = '01a16194-0000-7000-8000-0000000000c2';
const OTHER_CUSTOMERS_VEHICLE_ID = '01a16194-0000-7000-8000-0000000000e9';

const NOW = new Date('2026-10-20T00:00:00Z');
const utc = (iso: string) => new Date(iso);
const [t1, , t3] = scenario.technicianIds;
const [b1, , b3] = scenario.bayIds;
const [v1, v2, v3] = scenario.vehicleIds;

/** 08:00 to 17:30 in Asia/Ho_Chi_Minh (UTC+7). */
const saigonWorkday = (day: string) => ({
  startAt: utc(`${day}T01:00:00Z`),
  endAt: utc(`${day}T10:30:00Z`),
});

describe('Appointments (e2e)', () => {
  const clock = new FixedClock(NOW);
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ clock });
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

    await t.db
      .insertInto('technician')
      .values({
        id: SPARE_TECHNICIAN_ID,
        dealershipId: scenario.dealershipId,
        displayName: 'Technician 4',
      })
      .execute();
    await t.db
      .insertInto('technicianSkill')
      .values({ technicianId: SPARE_TECHNICIAN_ID, skillCode: 'GENERAL' })
      .execute();
    await t.db
      .insertInto('customer')
      .values({ id: OTHER_CUSTOMER_ID, fullName: 'Other Customer' })
      .execute();
    await t.db
      .insertInto('vehicle')
      .values([
        {
          id: SPARE_VEHICLE_ID,
          customerId: scenario.customerId,
          vin: 'WVWZZZ1KZAW000004',
          make: 'Volkswagen',
          model: 'Polo',
        },
        {
          id: OTHER_CUSTOMERS_VEHICLE_ID,
          customerId: OTHER_CUSTOMER_ID,
          vin: 'WVWZZZ1KZAW000009',
          make: 'Volkswagen',
          model: 'Tiguan',
        },
      ])
      .execute();

    // Every technician works Monday 2 to Friday 6 November; nobody works Saturday 7.
    await t.db
      .insertInto('technicianShift')
      .values(
        [
          '2026-11-02',
          '2026-11-03',
          '2026-11-04',
          '2026-11-05',
          '2026-11-06',
        ].flatMap((day) =>
          [...scenario.technicianIds, SPARE_TECHNICIAN_ID].map(
            (technicianId) => ({ technicianId, ...saigonWorkday(day) }),
          ),
        ),
      )
      .execute();

    // Thursday 5 November, 10:00 to 11:00 local: every bay is taken, the spare technician is not.
    await t.db
      .insertInto('appointment')
      .values(
        [0, 1, 2].map((i) =>
          appointment({
            technicianId: scenario.technicianIds[i],
            bayId: scenario.bayIds[i],
            vehicleId: scenario.vehicleIds[i],
            startAt: utc('2026-11-05T03:00:00Z'),
            endAt: utc('2026-11-05T04:00:00Z'),
          }),
        ),
      )
      .execute();
  });

  afterEach(() => clock.set(NOW));

  afterAll(() => t.app.close());

  describe('POST /v1/appointments', () => {
    const body = (overrides: Record<string, string> = {}) => ({
      dealershipId: scenario.dealershipId,
      customerId: scenario.customerId,
      vehicleId: v1,
      serviceTypeId: scenario.serviceTypeId,
      startAt: '2026-11-03T09:00:00+07:00',
      ...overrides,
    });

    const book = (payload: object, key: string = randomUUID()) =>
      t
        .http()
        .post('/v1/appointments')
        .set('Idempotency-Key', key)
        .send(payload);

    it('books the best technician and bay, and points Location at the appointment', async () => {
      const res = await book(body()).expect(201);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.headers.location).toBe(`/v1/appointments/${res.body.id}`);
      expect(res.body).toEqual({
        id: expect.any(String),
        status: 'CONFIRMED',
        dealershipId: scenario.dealershipId,
        customerId: scenario.customerId,
        vehicle: { id: v1, vin: 'WVWZZZ1KZAW000001' },
        serviceType: { code: 'OIL_SERVICE', durationMinutes: 60 },
        technician: { id: t1, displayName: 'Technician 1' },
        bay: { id: b1, name: 'Bay 1' },
        startAt: '2026-11-03T02:00:00.000Z',
        endAt: '2026-11-03T03:00:00.000Z',
        createdAt: expect.any(String),
        cancelledAt: null,
      });

      const read = await t.http().get(res.headers.location).expect(200);
      expect(read.body).toEqual(res.body);
    });

    it('answers 400 without an Idempotency-Key', async () => {
      const res = await t
        .http()
        .post('/v1/appointments')
        .send(body())
        .expect(400);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('answers 400 for a start time without a UTC offset', async () => {
      const res = await book(body({ startAt: '2026-11-03T09:00:00' })).expect(
        400,
      );

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body.errors).toContainEqual({
        field: 'startAt',
        messages: ['startAt must include a UTC offset (Z or ±hh:mm)'],
      });
    });

    describe('idempotency', () => {
      it('replays the same request with 200 and the same appointment', async () => {
        const key = randomUUID();
        const payload = body({ startAt: '2026-11-04T09:00:00+07:00' });
        const first = await book(payload, key).expect(201);

        const replay = await book(payload, key).expect(200);

        expectMatchesOpenApi(replay, 'Appointments_create');
        expect(replay.headers['idempotent-replayed']).toBe('true');
        expect(replay.headers.location).toBeUndefined();
        expect(replay.body).toEqual(first.body);
      });

      it('replays a request that only spells the offset and UUIDs differently', async () => {
        const key = randomUUID();
        const first = await book(
          body({ startAt: '2026-11-04T10:00:00+07:00' }),
          key,
        ).expect(201);

        const replay = await book(
          {
            dealershipId: scenario.dealershipId.toUpperCase(),
            customerId: scenario.customerId.toUpperCase(),
            vehicleId: v1.toUpperCase(),
            serviceTypeId: scenario.serviceTypeId.toUpperCase(),
            startAt: '2026-11-04T03:00:00Z',
          },
          key,
        ).expect(200);

        expect(replay.body.id).toBe(first.body.id);
      });

      it('answers 422 when the key is reused for a different request', async () => {
        const key = randomUUID();
        await book(body({ startAt: '2026-11-04T12:00:00+07:00' }), key).expect(
          201,
        );

        const res = await book(
          body({ startAt: '2026-11-04T13:00:00+07:00' }),
          key,
        ).expect(422);

        expectMatchesOpenApi(res, 'Appointments_create');
        expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      });
    });

    it.each([
      ['dealership', { dealershipId: UNKNOWN_ID }],
      ['customer', { customerId: UNKNOWN_ID }],
      ['vehicle', { vehicleId: UNKNOWN_ID }],
      ['service type', { serviceTypeId: UNKNOWN_ID }],
    ])('answers 404 for an unknown %s', async (resource, overrides) => {
      const res = await book(
        body({ startAt: '2026-11-03T11:00:00+07:00', ...overrides }),
      ).expect(404);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body).toMatchObject({
        code: 'NOT_FOUND',
        detail: `${resource} ${UNKNOWN_ID} was not found`,
      });
    });

    it('answers 422 for a vehicle the customer does not own', async () => {
      const res = await book(
        body({ vehicleId: OTHER_CUSTOMERS_VEHICLE_ID }),
      ).expect(422);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATED',
        rule: 'VEHICLE_NOT_OWNED',
      });
    });

    it.each([
      ['an off-grid start', '2026-11-03T09:07:00+07:00', 'OFF_GRID', NOW],
      [
        'a start sooner than the lead time',
        '2026-11-03T09:00:00+07:00',
        'TOO_SOON',
        utc('2026-11-03T01:50:00Z'), // 08:50 local
      ],
      [
        'a start beyond the horizon',
        '2027-02-01T09:00:00+07:00',
        'BEYOND_HORIZON',
        NOW,
      ],
      [
        'a start before opening',
        '2026-11-03T07:30:00+07:00',
        'OUTSIDE_OPENING_HOURS',
        NOW,
      ],
      [
        'a closed day',
        '2026-11-08T09:00:00+07:00',
        'OUTSIDE_OPENING_HOURS',
        NOW,
      ],
    ])('answers 422 for %s', async (_, startAt, rule, now) => {
      clock.set(now);
      const res = await book(body({ startAt })).expect(422);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body).toMatchObject({ code: 'BUSINESS_RULE_VIOLATED', rule });
    });

    it('explains an opening-hours refusal in local time', async () => {
      const res = await book(
        body({ startAt: '2026-11-03T17:00:00+07:00' }),
      ).expect(422);

      expect(res.body).toMatchObject({
        rule: 'OUTSIDE_OPENING_HOURS',
        detail:
          "17:00 to 18:00 on 2026-11-03 (Asia/Ho_Chi_Minh) is outside the dealership's opening hours",
      });
    });

    it('answers 409 when a technician is free but no bay is', async () => {
      const res = await book(
        body({
          vehicleId: SPARE_VEHICLE_ID,
          startAt: '2026-11-05T10:00:00+07:00',
        }),
      ).expect(409);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body).toMatchObject({
        code: 'SLOT_UNAVAILABLE',
        detail:
          'No qualified technician and compatible bay are both free from 10:00 to 11:00 on 2026-11-05 (Asia/Ho_Chi_Minh)',
        // The bays free up at 11:00 local.
        alternatives: [
          '2026-11-05T04:00:00.000Z',
          '2026-11-05T04:15:00.000Z',
          '2026-11-05T04:30:00.000Z',
        ],
      });
    });

    it('never suggests an alternative past the booking horizon', async () => {
      clock.set(utc('2026-08-07T04:15:00Z')); // the horizon is 11:15 local on 5 November
      const res = await book(
        body({
          vehicleId: SPARE_VEHICLE_ID,
          startAt: '2026-11-05T10:00:00+07:00',
        }),
      ).expect(409);

      expect(res.body.alternatives).toEqual([
        '2026-11-05T04:00:00.000Z',
        '2026-11-05T04:15:00.000Z',
      ]);
    });

    it('answers 409 when a bay is free but no technician works', async () => {
      const res = await book(
        body({
          vehicleId: SPARE_VEHICLE_ID,
          startAt: '2026-11-07T09:00:00+07:00',
        }),
      ).expect(409);

      // Nobody works again within the 7 days searched.
      expect(res.body).toMatchObject({
        code: 'SLOT_UNAVAILABLE',
        alternatives: [],
      });
    });

    it('answers 409 when the vehicle already has an overlapping appointment', async () => {
      await book(
        body({ vehicleId: v2, startAt: '2026-11-06T09:00:00+07:00' }),
      ).expect(201);

      const res = await book(
        body({ vehicleId: v2, startAt: '2026-11-06T09:30:00+07:00' }),
      ).expect(409);

      expectMatchesOpenApi(res, 'Appointments_create');
      expect(res.body.code).toBe('VEHICLE_ALREADY_BOOKED');
    });

    it('answers 503 while a competing booking holds the vehicle, and the same key succeeds afterwards', async () => {
      // Uncommitted, so the vehicle pre-check and the snapshot cannot see it; only the insert waits.
      const holder = holdInsert(
        t.db,
        appointment({
          vehicleId: v3,
          technicianId: t3,
          bayId: b3,
          startAt: utc('2026-11-06T07:00:00Z'),
          endAt: utc('2026-11-06T08:00:00Z'),
        }),
      );
      await holder.inserted;
      const key = randomUUID();
      const payload = body({
        vehicleId: v3,
        startAt: '2026-11-06T14:00:00+07:00',
      });

      try {
        const res = await book(payload, key).expect(503);

        expectMatchesOpenApi(res, 'Appointments_create');
        expect(res.headers['retry-after']).toBe('1');
        expect(res.body.code).toBe('TEMPORARILY_UNAVAILABLE');
      } finally {
        holder.rollback();
        await holder.done.catch(() => undefined);
      }

      await book(payload, key).expect(201);
    });
  });

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
