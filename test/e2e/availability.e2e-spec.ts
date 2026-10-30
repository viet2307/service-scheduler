import { FixedClock } from '../support/clock';
import { appointment, createScenario, scenario } from '../support/fixtures';
import { createTestApp, TestApp } from './support/app';
import { expectMatchesOpenApi } from './support/openapi';

const UNKNOWN_ID = '01a16194-0000-7000-8000-0000000000ff';
const NOW = new Date('2026-10-20T00:00:00Z');
const utc = (iso: string) => new Date(iso);

/** 08:00 to 17:30 in Asia/Ho_Chi_Minh (UTC+7) on a November day. */
const saigonWorkday = (day: string) => ({
  startAt: utc(`${day}T01:00:00Z`),
  endAt: utc(`${day}T10:30:00Z`),
});

describe('Availability (e2e)', () => {
  const clock = new FixedClock(NOW);
  let t: TestApp;

  const availability = (
    query: Record<string, string>,
    dealershipId: string = scenario.dealershipId,
  ) =>
    t
      .http()
      .get(`/v1/dealerships/${dealershipId}/availability`)
      .query({ serviceTypeId: scenario.serviceTypeId, ...query });

  const startsOf = (res: { body: { slots: { startAt: string }[] } }) =>
    res.body.slots.map((slot) => slot.startAt);

  beforeAll(async () => {
    t = await createTestApp({ clock });
    await createScenario(t.db);

    // Monday 2 November is empty, Tuesday 3 fully booked, Wednesday 4 has two technicians busy at 09:00.
    await t.db
      .insertInto('technicianShift')
      .values(
        ['2026-11-02', '2026-11-03', '2026-11-04'].flatMap((day) =>
          scenario.technicianIds.map((technicianId) => ({
            technicianId,
            ...saigonWorkday(day),
          })),
        ),
      )
      .execute();
    await t.db
      .insertInto('appointment')
      .values([
        ...[0, 1, 2].map((i) =>
          appointment({
            technicianId: scenario.technicianIds[i],
            bayId: scenario.bayIds[i],
            vehicleId: scenario.vehicleIds[i],
            ...saigonWorkday('2026-11-03'),
          }),
        ),
        ...[0, 1].map((i) =>
          appointment({
            technicianId: scenario.technicianIds[i],
            bayId: scenario.bayIds[i],
            vehicleId: scenario.vehicleIds[i],
            startAt: utc('2026-11-04T02:00:00Z'),
            endAt: utc('2026-11-04T03:00:00Z'),
          }),
        ),
      ])
      .execute();

    // London's clocks go back on Sunday 25 October 2026.
    await t.db
      .insertInto('dealershipOpeningHours')
      .values(
        [6, 7].map((isoWeekday) => ({
          dealershipId: scenario.otherDealershipId,
          isoWeekday,
          opensAt: '08:00',
          closesAt: '17:30',
        })),
      )
      .execute();
    await t.db
      .insertInto('technicianSkill')
      .values({
        technicianId: scenario.otherDealershipTechnicianId,
        skillCode: 'GENERAL',
      })
      .execute();
    await t.db
      .insertInto('technicianShift')
      .values([
        {
          technicianId: scenario.otherDealershipTechnicianId,
          startAt: utc('2026-10-24T07:00:00Z'),
          endAt: utc('2026-10-24T16:30:00Z'),
        },
        {
          technicianId: scenario.otherDealershipTechnicianId,
          startAt: utc('2026-10-25T08:00:00Z'),
          endAt: utc('2026-10-25T17:30:00Z'),
        },
      ])
      .execute();
  });

  afterEach(() => clock.set(NOW));

  afterAll(() => t.app.close());

  it('lists every start of an empty day on the local 15-minute grid', async () => {
    const res = await availability({ date: '2026-11-02' }).expect(200);

    expectMatchesOpenApi(res, 'Availability_get');
    expect(res.body).toMatchObject({
      dealershipId: scenario.dealershipId,
      serviceTypeId: scenario.serviceTypeId,
      date: '2026-11-02',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(res.body.slots).toHaveLength(35);
    expect(res.body.slots[0]).toEqual({
      startAt: '2026-11-02T01:00:00.000Z',
      endAt: '2026-11-02T02:00:00.000Z',
      freeTechnicians: 3,
      freeBays: 3,
    });
    // 16:30 local: the last start that ends by closing time.
    expect(startsOf(res).at(-1)).toBe('2026-11-02T09:30:00.000Z');
  });

  it('returns no slots for a fully booked day', async () => {
    const res = await availability({ date: '2026-11-03' }).expect(200);
    expect(res.body.slots).toEqual([]);
  });

  it('counts the technicians and bays still free', async () => {
    const res = await availability({ date: '2026-11-04' }).expect(200);
    const slots: { startAt: string }[] = res.body.slots;
    const slot = (startAt: string) => slots.find((s) => s.startAt === startAt);

    expect(slot('2026-11-04T01:00:00.000Z')).toMatchObject({
      freeTechnicians: 3,
      freeBays: 3,
    });
    expect(slot('2026-11-04T02:00:00.000Z')).toMatchObject({
      freeTechnicians: 1,
      freeBays: 1,
    });
  });

  it.each([
    ['2026-10-24', '2026-10-24T07:00:00.000Z', '2026-10-24T15:30:00.000Z'],
    ['2026-10-25', '2026-10-25T08:00:00.000Z', '2026-10-25T16:30:00.000Z'],
  ])(
    'keeps 08:00 to 16:30 local in London on %s, either side of the DST change',
    async (date, first, last) => {
      const res = await availability(
        { date },
        scenario.otherDealershipId,
      ).expect(200);

      expect(res.body.timeZone).toBe('Europe/London');
      expect(startsOf(res)[0]).toBe(first);
      expect(startsOf(res).at(-1)).toBe(last);
    },
  );

  it('starts no earlier than the minimum lead time from now', async () => {
    clock.set(utc('2026-11-02T02:10:00Z')); // 09:10 local; + 30 min lead = 09:40
    const res = await availability({ date: '2026-11-02' }).expect(200);
    expect(startsOf(res)[0]).toBe('2026-11-02T02:45:00.000Z');
  });

  it('stops at the booking horizon, which is itself bookable', async () => {
    clock.set(utc('2026-08-04T03:00:00Z')); // 90 days before 10:00 local on 2 November
    const res = await availability({ date: '2026-11-02' }).expect(200);
    expect(startsOf(res).at(-1)).toBe('2026-11-02T03:00:00.000Z');
  });

  it('returns no slots for a past day', async () => {
    const res = await availability({ date: '2026-10-19' }).expect(200);
    expect(res.body.slots).toEqual([]);
  });

  it.each([
    ['dealership', UNKNOWN_ID, scenario.serviceTypeId],
    ['service type', scenario.dealershipId, UNKNOWN_ID],
  ])(
    'answers 404 for an unknown %s',
    async (resource, dealershipId, serviceTypeId) => {
      const res = await availability(
        { serviceTypeId, date: '2026-11-02' },
        dealershipId,
      ).expect(404);

      expectMatchesOpenApi(res, 'Availability_get');
      expect(res.body).toMatchObject({
        code: 'NOT_FOUND',
        detail: `${resource} ${UNKNOWN_ID} was not found`,
      });
    },
  );

  it.each([
    [
      'an impossible date',
      { date: '2026-02-30' },
      'date',
      'date must be a calendar date',
    ],
    [
      'a date in another format',
      { date: '02/11/2026' },
      'date',
      'date must be YYYY-MM-DD',
    ],
    [
      'a malformed service type id',
      { date: '2026-11-02', serviceTypeId: 'x' },
      'serviceTypeId',
      'serviceTypeId must be a UUID',
    ],
  ])('answers 400 for %s', async (_, query, field, message) => {
    const res = await availability(query).expect(400);

    expectMatchesOpenApi(res, 'Availability_get');
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toContainEqual({
      field,
      messages: expect.arrayContaining([message]),
    });
  });
});
