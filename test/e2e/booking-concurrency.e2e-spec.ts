import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'kysely';
import type { Response, Test } from 'supertest';
import { AppointmentRepository } from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import { FixedClock } from '../support/clock';
import { createScenario, scenario } from '../support/fixtures';
import { createTestApp, TestApp } from './support/app';

const RECONCILE = readFileSync(
  resolve(__dirname, '..', '..', 'scripts', 'sql', 'reconcile-overlaps.sql'),
  'utf8',
);

const NOW = new Date('2026-10-20T00:00:00Z');
const PARALLEL = 20;
const vehicleIds = Array.from(
  { length: PARALLEL },
  (_, i) =>
    `01a16194-0000-7000-8000-${(0xe100 + i).toString(16).padStart(12, '0')}`,
);
const utc = (iso: string) => new Date(iso);
/** Locked by the gate alongside the pair the requests choose; no request books it. */
const GATE_VEHICLE_ID = scenario.vehicleIds[2];

/** How many responses had each status, e.g. `{ 201: 1, 409: 19 }`. */
const countByStatus = (responses: Response[]) =>
  responses.reduce<Record<number, number>>(
    (counts, { status }) => ({
      ...counts,
      [status]: (counts[status] ?? 0) + 1,
    }),
    {},
  );

// Each scenario asserts outcomes that hold under every interleaving (exact
// counts, zero overlaps), never timing, so the suite cannot be flaky by construction.
describe('Booking under contention (e2e)', () => {
  let t: TestApp;

  const book = (body: object, key: string = randomUUID()) =>
    t.http().post('/v1/appointments').set('Idempotency-Key', key).send(body);

  /** Advisory locks other requests are waiting for in this suite's database. */
  const waitingForLocks = async () => {
    const { rows } = await sql<{ waiting: number }>`
      select count(*)::int as waiting
      from pg_locks
      where locktype = 'advisory'
        and not granted
        and database = (select oid from pg_database where datname = current_database())
    `.execute(t.db);
    return rows[0].waiting;
  };

  /**
   * Sends the requests together, but lets them insert only once all of them wait for the locks of
   * the technician and bay they all rank first. Every request has then read its snapshot before the
   * first insert, so all but one lose the race. Without this gate, requests finish at different
   * moments, later ones read a snapshot that already holds the winners, and the suite would pass
   * even without the retry.
   */
  async function race(
    pair: { technicianId: string; bayId: string },
    requests: (() => Test)[],
  ): Promise<Response[]> {
    const host = t.app.get(TransactionHost);
    const appointments = t.app.get(AppointmentRepository);
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const gate = host.run(async () => {
      await appointments.lockForBooking({
        ...pair,
        vehicleId: GATE_VEHICLE_ID,
      });
      signalLocked();
      await opened;
    });
    await locked;

    const responses = Promise.all(requests.map((send) => send()));
    try {
      for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
        if ((await waitingForLocks()) >= requests.length) break;
        if (Date.now() > deadline)
          throw new Error(
            `Not all ${requests.length} requests reached the locks`,
          );
      }
    } finally {
      open();
      await gate;
    }
    return responses;
  }

  const request = (overrides: {
    dealershipId?: string;
    vehicleId: string;
    startAt: string;
  }) => ({
    dealershipId: scenario.dealershipId,
    customerId: scenario.customerId,
    serviceTypeId: scenario.serviceTypeId,
    ...overrides,
  });

  beforeAll(async () => {
    // Every request holds a connection while it waits at the gate; two more serve the gate itself.
    t = await createTestApp({
      clock: new FixedClock(NOW),
      poolMax: PARALLEL + 2,
    });
    await createScenario(t.db);
    await t.db
      .insertInto('vehicle')
      .values(
        vehicleIds.map((id, i) => ({
          id,
          customerId: scenario.customerId,
          vin: `WVWZZZ1KZAW1${String(i).padStart(5, '0')}`,
          make: 'Volkswagen',
          model: 'ID.4',
        })),
      )
      .execute();

    // London has one technician and one bay; it opens 08:00 to 17:30 on Monday (GMT, so UTC).
    await t.db
      .insertInto('dealershipOpeningHours')
      .values({
        dealershipId: scenario.otherDealershipId,
        isoWeekday: 1,
        opensAt: '08:00',
        closesAt: '17:30',
      })
      .execute();
    await t.db
      .insertInto('technicianSkill')
      .values({
        technicianId: scenario.otherDealershipTechnicianId,
        skillCode: 'GENERAL',
      })
      .execute();
    // Shifts: London on Monday 2 November; Saigon's three technicians on Tuesday 3 and Wednesday 4.
    await t.db
      .insertInto('technicianShift')
      .values([
        {
          technicianId: scenario.otherDealershipTechnicianId,
          startAt: utc('2026-11-02T08:00:00Z'),
          endAt: utc('2026-11-02T17:30:00Z'),
        },
        ...['2026-11-03', '2026-11-04'].flatMap((day) =>
          scenario.technicianIds.map((technicianId) => ({
            technicianId,
            startAt: utc(`${day}T01:00:00Z`),
            endAt: utc(`${day}T10:30:00Z`),
          })),
        ),
      ])
      .execute();
  });

  afterEach(async () => {
    expect((await sql.raw(RECONCILE).execute(t.db)).rows).toEqual([]);
  });

  afterAll(() => t.app.close());

  it(`confirms exactly one of ${PARALLEL} requests for the last technician and bay`, async () => {
    const responses = await race(
      {
        technicianId: scenario.otherDealershipTechnicianId,
        bayId: scenario.otherDealershipBayId,
      },
      vehicleIds.map(
        (vehicleId) => () =>
          book(
            request({
              dealershipId: scenario.otherDealershipId,
              vehicleId,
              startAt: '2026-11-02T10:00:00Z',
            }),
          ),
      ),
    );

    expect(countByStatus(responses)).toEqual({ 201: 1, 409: PARALLEL - 1 });
    for (const res of responses.filter((r) => r.status === 409))
      expect(res.body.code).toBe('SLOT_UNAVAILABLE');
  });

  // Without the re-read after a lost race, losers collide again on the winner's bay and run out
  // of attempts while technicians and bays are still free.
  it(`confirms exactly three of ${PARALLEL} requests when three technicians and three bays are free`, async () => {
    const responses = await race(
      { technicianId: scenario.technicianIds[0], bayId: scenario.bayIds[0] },
      vehicleIds.map(
        (vehicleId) => () =>
          book(request({ vehicleId, startAt: '2026-11-03T09:00:00+07:00' })),
      ),
    );

    expect(countByStatus(responses)).toEqual({ 201: 3, 409: PARALLEL - 3 });
    const confirmed = responses.filter((r) => r.status === 201);
    expect(new Set(confirmed.map((r) => r.body.technician.id)).size).toBe(3);
    expect(new Set(confirmed.map((r) => r.body.bay.id)).size).toBe(3);
  });

  it('stores one appointment for 10 simultaneous requests with the same key, and answers each with it', async () => {
    const key = randomUUID();
    const body = request({
      vehicleId: vehicleIds[0],
      startAt: '2026-11-04T09:00:00+07:00',
    });

    const responses = await race(
      { technicianId: scenario.technicianIds[0], bayId: scenario.bayIds[0] },
      Array.from({ length: 10 }, () => () => book(body, key)),
    );

    expect(countByStatus(responses)).toEqual({ 201: 1, 200: 9 });
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    const stored = await t.db
      .selectFrom('appointment')
      .select('id')
      .where('idempotencyKey', '=', key)
      .execute();
    expect(stored).toEqual([{ id: responses[0].body.id }]);
  });
});
