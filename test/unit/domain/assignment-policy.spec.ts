import fc from 'fast-check';
import {
  BayCandidate,
  Interval,
  localDayWindow,
  rankBays,
  rankTechnicians,
  TechnicianCandidate,
} from '@/domain';

const DAY = localDayWindow('2026-11-02', 'UTC');
const at = (time: string) => Date.parse(`2026-11-02T${time}:00Z`);
const iv = (from: string, to: string): Interval => ({
  start: at(from),
  end: at(to),
});

const technician = (
  id: string,
  extraSkillCount = 0,
  busy: Interval[] = [],
): TechnicianCandidate => ({
  id,
  extraSkillCount,
  shifts: [iv('08:00', '17:30')],
  busy,
});

const bay = (
  id: string,
  name: string,
  busy: Interval[] = [],
): BayCandidate => ({
  id,
  name,
  busy,
});

const ids = (ranked: { id: string }[]) => ranked.map((c) => c.id);

describe('assignment policy', () => {
  describe('rankTechnicians', () => {
    it('prefers the technician with fewer extra skills, even when busier', () => {
      const specialist = technician('ev', 2);
      const generalist = technician('general', 0, [iv('08:00', '12:00')]);

      expect(ids(rankTechnicians([specialist, generalist], DAY))).toEqual([
        'general',
        'ev',
      ]);
    });

    it('then prefers fewer booked minutes that day', () => {
      expect(
        ids(
          rankTechnicians(
            [
              technician('a', 0, [iv('08:00', '10:00')]),
              technician('b', 0, [iv('08:00', '09:00'), iv('13:00', '13:30')]),
            ],
            DAY,
          ),
        ),
      ).toEqual(['b', 'a']);
    });

    it('counts only the minutes inside the day', () => {
      const yesterdayEvening = {
        start: DAY.start - 3 * 3_600_000,
        end: DAY.start + 30 * 60_000,
      };
      expect(
        ids(
          rankTechnicians(
            [
              technician('a', 0, [yesterdayEvening]),
              technician('b', 0, [iv('09:00', '10:00')]),
            ],
            DAY,
          ),
        ),
      ).toEqual(['a', 'b']);
    });

    it('then orders by id', () => {
      expect(
        ids(rankTechnicians([technician('t2'), technician('t1')], DAY)),
      ).toEqual(['t1', 't2']);
    });
  });

  describe('rankBays', () => {
    it('prefers fewer booked minutes, then name, then id', () => {
      expect(
        ids(
          rankBays(
            [
              bay('b1', 'Bay 1', [iv('08:00', '09:00')]),
              bay('b3', 'Bay 2'),
              bay('b2', 'Bay 2'),
              bay('b4', 'Bay 0', [iv('10:00', '12:00')]),
            ],
            DAY,
          ),
        ),
      ).toEqual(['b2', 'b3', 'b1', 'b4']);
    });
  });

  it('gives the same order for any input order', () => {
    const busy = fc.array(
      fc
        .tuple(fc.integer({ min: 0, max: 96 }), fc.integer({ min: 1, max: 16 }))
        .map(([q, n]) => ({
          start: DAY.start + q * 900_000,
          end: DAY.start + (q + n) * 900_000,
        })),
      { maxLength: 3 },
    );
    const technicians = fc.uniqueArray(
      fc.record({
        id: fc.constantFrom('t1', 't2', 't3', 't4', 't5'),
        extraSkillCount: fc.integer({ min: 0, max: 2 }),
        shifts: fc.constant([DAY]),
        busy,
      }),
      { selector: (t) => t.id, minLength: 1 },
    );
    const bays = fc.uniqueArray(
      fc.record({
        id: fc.constantFrom('b1', 'b2', 'b3', 'b4'),
        name: fc.constantFrom('Bay 1', 'Bay 2'),
        busy,
      }),
      { selector: (b) => b.id, minLength: 1 },
    );

    fc.assert(
      fc.property(technicians, bays, fc.func(fc.integer()), (ts, bs, key) => {
        const shuffle = <T>(xs: T[]) =>
          xs
            .map((x, i) => ({ x, k: key(i) }))
            .sort((a, b) => a.k - b.k)
            .map(({ x }) => x);
        expect(ids(rankTechnicians(shuffle(ts), DAY))).toEqual(
          ids(rankTechnicians(ts, DAY)),
        );
        expect(ids(rankBays(shuffle(bs), DAY))).toEqual(ids(rankBays(bs, DAY)));
      }),
    );
  });
});
