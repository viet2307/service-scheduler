import {
  CamelCasePlugin,
  CompiledQuery,
  Kysely,
  PostgresDialect,
} from 'kysely';
import { Pool } from 'pg';
import { createDatabase } from '@/persistence/database';
import type { DB } from '@/persistence/database.types';
import type { TimeWindow } from '@/persistence/ranges';
import {
  AppointmentRepository,
  BayRepository,
  DealershipRepository,
  TechnicianRepository,
} from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import { createMigratedTestDatabase } from '../../support/database';
import {
  appointment,
  at,
  createScenario,
  scenario,
} from '../../support/fixtures';

const date = (iso: string) => new Date(iso);

/** Monday 2 November 2026 in Asia/Ho_Chi_Minh (UTC+7). */
const WINDOW: TimeWindow = {
  from: date('2026-11-01T17:00:00Z'),
  to: date('2026-11-02T17:00:00Z'),
};

const EV_ONLY_TECHNICIAN_ID = '01a16194-0000-7000-8000-0000000000f5';
const EV_BAY_ID = '01a16194-0000-7000-8000-0000000000b5';
const [t1, t2, t3] = scenario.technicianIds;
const [b1, b2, b3] = scenario.bayIds;

describe('Availability snapshot queries', () => {
  let url: string;
  let db: Kysely<DB>;
  let host: TransactionHost;

  beforeAll(async () => {
    url = await createMigratedTestDatabase();
    db = createDatabase({ connectionString: url });
    host = new TransactionHost(db);
    await createScenario(db);

    await db
      .insertInto('technician')
      .values({
        id: EV_ONLY_TECHNICIAN_ID,
        dealershipId: scenario.dealershipId,
        displayName: 'EV only',
      })
      .execute();
    await db
      .insertInto('technicianSkill')
      .values([
        { technicianId: t1, skillCode: 'EV_HV' },
        { technicianId: EV_ONLY_TECHNICIAN_ID, skillCode: 'EV_HV' },
        {
          technicianId: scenario.otherDealershipTechnicianId,
          skillCode: 'GENERAL',
        },
      ])
      .execute();
    await db
      .updateTable('technician')
      .set({ isActive: false })
      .where('id', '=', t3)
      .execute();
    await db
      .insertInto('technicianShift')
      .values([
        // Ends exactly when the window starts, so it does not overlap it.
        {
          technicianId: t1,
          startAt: date('2026-11-01T10:00:00Z'),
          endAt: WINDOW.from,
        },
        {
          technicianId: t1,
          startAt: date('2026-11-02T01:00:00Z'),
          endAt: date('2026-11-02T10:30:00Z'),
        },
        {
          technicianId: t1,
          startAt: date('2026-11-02T16:00:00Z'),
          endAt: date('2026-11-02T20:00:00Z'),
        },
        {
          technicianId: t1,
          startAt: date('2026-11-03T01:00:00Z'),
          endAt: date('2026-11-03T10:30:00Z'),
        },
        {
          technicianId: t3,
          startAt: date('2026-11-02T01:00:00Z'),
          endAt: date('2026-11-02T10:30:00Z'),
        },
      ])
      .execute();

    await db
      .insertInto('serviceBay')
      .values({
        id: EV_BAY_ID,
        dealershipId: scenario.dealershipId,
        name: 'Bay 5 (EV)',
        bayType: 'EV_HV',
      })
      .execute();
    await db
      .updateTable('serviceBay')
      .set({ isActive: false })
      .where('id', '=', b3)
      .execute();

    await db
      .insertInto('appointment')
      .values([
        appointment(),
        appointment({
          startAt: at('13:00'),
          endAt: at('14:00'),
          status: 'COMPLETED',
        }),
        appointment({
          vehicleId: scenario.vehicleIds[1],
          technicianId: t2,
          bayId: b2,
          startAt: at('11:00'),
          endAt: at('12:00'),
          status: 'CANCELLED',
          cancelledAt: at('08:00'),
        }),
        // Starts exactly when the window ends.
        appointment({
          vehicleId: scenario.vehicleIds[1],
          technicianId: t2,
          bayId: b2,
          startAt: at('17:00'),
          endAt: at('18:00'),
        }),
        appointment({
          dealershipId: scenario.otherDealershipId,
          vehicleId: scenario.vehicleIds[2],
          technicianId: scenario.otherDealershipTechnicianId,
          bayId: scenario.otherDealershipBayId,
        }),
      ])
      .execute();
  });

  afterAll(() => db.destroy());

  it('reads opening hours by weekday', async () => {
    const hours = await new DealershipRepository(host).getOpeningHours(
      scenario.dealershipId,
    );
    expect(hours).toHaveLength(6);
    expect(hours[0]).toEqual({
      isoWeekday: 1,
      opensAt: '08:00:00',
      closesAt: '17:30:00',
    });
  });

  describe('TechnicianRepository.findQualified', () => {
    const technicians = () => new TechnicianRepository(host);

    it('returns active technicians with the skill, their other skills and the shifts overlapping the window', async () => {
      await expect(
        technicians().findQualified(scenario.dealershipId, 'GENERAL', WINDOW),
      ).resolves.toEqual([
        {
          id: t1,
          extraSkillCount: 1,
          shifts: [
            {
              startAt: date('2026-11-02T01:00:00Z'),
              endAt: date('2026-11-02T10:30:00Z'),
            },
            {
              startAt: date('2026-11-02T16:00:00Z'),
              endAt: date('2026-11-02T20:00:00Z'),
            },
          ],
        },
        { id: t2, extraSkillCount: 0, shifts: [] },
      ]);
    });

    it('filters by the required skill', async () => {
      const qualified = await technicians().findQualified(
        scenario.dealershipId,
        'EV_HV',
        WINDOW,
      );
      expect(qualified.map((t) => [t.id, t.extraSkillCount])).toEqual([
        [t1, 1],
        [EV_ONLY_TECHNICIAN_ID, 0],
      ]);
    });
  });

  it('BayRepository.findCompatible returns active bays of the bay type by name', async () => {
    const bays = new BayRepository(host);
    await expect(
      bays.findCompatible(scenario.dealershipId, 'LIFT'),
    ).resolves.toEqual([
      { id: b1, name: 'Bay 1' },
      { id: b2, name: 'Bay 2' },
    ]);
    await expect(
      bays.findCompatible(scenario.dealershipId, 'EV_HV'),
    ).resolves.toEqual([{ id: EV_BAY_ID, name: 'Bay 5 (EV)' }]);
  });

  describe('AppointmentRepository busy queries', () => {
    const appointments = () => new AppointmentRepository(host);
    const byStart = <T extends { startAt: Date }>(rows: T[]) =>
      [...rows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    it('return the blocking appointments in the window, ignoring cancelled ones and other dealerships', async () => {
      const ids = [t1, t2, scenario.otherDealershipTechnicianId];
      expect(
        byStart(
          await appointments().findBusyTechnicians(
            scenario.dealershipId,
            ids,
            WINDOW,
          ),
        ),
      ).toEqual([
        { technicianId: t1, startAt: at('09:00'), endAt: at('10:00') },
        { technicianId: t1, startAt: at('13:00'), endAt: at('14:00') },
      ]);
      expect(
        byStart(
          await appointments().findBusyBays(
            scenario.dealershipId,
            [b1, b2, scenario.otherDealershipBayId],
            WINDOW,
          ),
        ),
      ).toEqual([
        { bayId: b1, startAt: at('09:00'), endAt: at('10:00') },
        { bayId: b1, startAt: at('13:00'), endAt: at('14:00') },
      ]);
    });

    it('only look at the requested resources', async () => {
      await expect(
        appointments().findBusyTechnicians(scenario.dealershipId, [t2], WINDOW),
      ).resolves.toEqual([]);
      await expect(
        appointments().findBusyTechnicians(scenario.dealershipId, [], WINDOW),
      ).resolves.toEqual([]);
      await expect(
        appointments().findBusyBays(scenario.dealershipId, [], WINDOW),
      ).resolves.toEqual([]);
    });

    /** EXPLAIN of the query the repository sends, with sequential scans off. */
    async function planOf(
      run: (repository: AppointmentRepository) => Promise<unknown>,
    ): Promise<string> {
      const queries: CompiledQuery[] = [];
      const logged = new Kysely<DB>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: url, max: 1 }),
        }),
        plugins: [new CamelCasePlugin()],
        log: (event) => {
          if (event.level === 'query') queries.push(event.query);
        },
      });
      try {
        await run(new AppointmentRepository(new TransactionHost(logged)));
        const [query] = queries;
        return await logged.connection().execute(async (connection) => {
          await connection.executeQuery(
            CompiledQuery.raw('set enable_seqscan = off'),
          );
          const { rows } = await connection.executeQuery(
            CompiledQuery.raw(`explain ${query.sql}`, [...query.parameters]),
          );
          return rows
            .map((row) => Object.values(row as object)[0] as string)
            .join('\n');
        });
      } finally {
        await logged.destroy();
      }
    }

    // On a table this small the three exclusion indexes cost the same, so the planner may pick any
    // of them. What must hold is that the overlap test is an index condition: a rewrite such as
    // `start_at < $to AND end_at > $from` would lose that (evidence E1).
    it.each([
      [
        'findBusyTechnicians',
        (r: AppointmentRepository) =>
          r.findBusyTechnicians(scenario.dealershipId, [t1, t2], WINDOW),
      ],
      [
        'findBusyBays',
        (r: AppointmentRepository) =>
          r.findBusyBays(scenario.dealershipId, [b1, b2], WINDOW),
      ],
    ])(
      '%s searches the window through an exclusion-constraint index',
      async (_, run) => {
        const plan = await planOf(run);
        expect(plan).toMatch(
          /(Index Scan using|Bitmap Index Scan on) appointment_no_\w+_overlap/,
        );
        expect(plan).toMatch(/Index Cond: .*tstzrange\(start_at, end_at/);
      },
    );
  });
});
