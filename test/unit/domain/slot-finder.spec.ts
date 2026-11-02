import fc from 'fast-check';
import {
  BayCandidate,
  contains,
  findBookableStarts,
  freeResourcesAt,
  gridPoints,
  intersect,
  Interval,
  localDayWindow,
  MINUTE,
  normalize,
  overlaps,
  Snapshot,
  SlotSearch,
  TechnicianCandidate,
  technicianFreeTime,
} from '@/domain';

const ZONE = 'UTC';
const DAY = localDayWindow('2026-11-02', ZONE);
const at = (time: string) => Date.parse(`2026-11-02T${time}:00Z`);
const iv = (from: string, to: string): Interval => ({
  start: at(from),
  end: at(to),
});
const OPENING = [iv('08:00', '17:30')];

const technician = (
  id: string,
  overrides: Partial<TechnicianCandidate> = {},
): TechnicianCandidate => ({
  id,
  extraSkillCount: 0,
  shifts: [iv('08:00', '17:30')],
  busy: [],
  ...overrides,
});

const bay = (id: string, busy: Interval[] = []): BayCandidate => ({
  id,
  name: id,
  busy,
});

const search = (
  snapshot: Partial<Snapshot>,
  overrides: Partial<SlotSearch> = {},
): SlotSearch => ({
  snapshot: {
    opening: OPENING,
    technicians: [technician('t1')],
    bays: [bay('b1')],
    ...snapshot,
  },
  durationMinutes: 60,
  window: DAY,
  zone: ZONE,
  gridMinutes: 15,
  earliestStart: DAY.start,
  latestStart: DAY.end,
  ...overrides,
});

const startsOf = (s: SlotSearch) =>
  findBookableStarts(s).map((slot) =>
    new Date(slot.start).toISOString().slice(11, 16),
  );

describe('slot finder', () => {
  describe('technicianFreeTime', () => {
    it('merges back-to-back shifts into one block and clips them to opening hours', () => {
      const t = technician('t1', {
        shifts: [iv('07:00', '12:00'), iv('12:00', '17:00')],
        busy: [iv('13:00', '14:00')],
      });
      expect(technicianFreeTime(t, OPENING)).toEqual([
        iv('08:00', '13:00'),
        iv('14:00', '17:00'),
      ]);
    });
  });

  describe('freeResourcesAt', () => {
    const snapshot: Snapshot = {
      opening: OPENING,
      technicians: [technician('t1', { shifts: [iv('08:00', '10:00')] })],
      bays: [bay('b1', [iv('08:00', '09:00')])],
    };

    it('accepts a slot ending exactly when the shift ends and starting when a booking ends', () => {
      const free = freeResourcesAt(snapshot, iv('09:00', '10:00'));
      expect(free.technicians.map((t) => t.id)).toEqual(['t1']);
      expect(free.bays.map((b) => b.id)).toEqual(['b1']);
    });

    it('rejects a slot that runs one minute past the shift or into a booking', () => {
      expect(
        freeResourcesAt(snapshot, iv('09:01', '10:01')).technicians,
      ).toEqual([]);
      expect(freeResourcesAt(snapshot, iv('08:59', '09:59')).bays).toEqual([]);
    });
  });

  describe('findBookableStarts', () => {
    it('returns every grid start inside opening hours on an empty day', () => {
      const starts = startsOf(search({}));
      expect(starts[0]).toBe('08:00');
      expect(starts.at(-1)).toBe('16:30');
      expect(starts).toHaveLength(35);
    });

    it('finds nothing when technicians are free but no bay is', () => {
      expect(
        startsOf(search({ bays: [bay('b1', [iv('00:00', '23:59')])] })),
      ).toEqual([]);
    });

    it('finds nothing when bays are free but no technician works', () => {
      expect(
        startsOf(search({ technicians: [technician('t1', { shifts: [] })] })),
      ).toEqual([]);
    });

    it('counts the free technicians and bays of each start', () => {
      const busyAtNine = { busy: [iv('09:00', '10:00')] };
      const slots = findBookableStarts(
        search({
          technicians: [
            technician('t1', busyAtNine),
            technician('t2', busyAtNine),
            technician('t3'),
          ],
          bays: [bay('b1'), bay('b2')],
        }),
      );
      const byStart = new Map(slots.map((s) => [s.start, s]));

      expect(byStart.get(at('09:00'))).toMatchObject({
        freeTechnicians: 1,
        freeBays: 2,
      });
      expect(byStart.get(at('10:00'))).toMatchObject({
        freeTechnicians: 3,
        freeBays: 2,
      });
      expect(byStart.get(at('09:00'))?.end).toBe(at('10:00'));
    });

    it('keeps starts between the earliest and latest start, both inclusive', () => {
      expect(
        startsOf(
          search({}, { earliestStart: at('10:00'), latestStart: at('10:30') }),
        ),
      ).toEqual(['10:00', '10:15', '10:30']);
    });

    it('finds nothing on a closed day', () => {
      expect(startsOf(search({ opening: [] }))).toEqual([]);
    });
  });

  describe('properties', () => {
    const QUARTERS = 96;
    const quarter = fc.integer({ min: 0, max: QUARTERS });
    const anInterval = fc.tuple(quarter, quarter).map(([a, b]) => ({
      start: DAY.start + Math.min(a, b) * 15 * MINUTE,
      end: DAY.start + Math.max(a, b) * 15 * MINUTE,
    }));
    const intervals = fc.array(anInterval, { maxLength: 3 });
    const aSnapshot = fc.record({
      opening: intervals,
      technicians: fc
        .array(fc.record({ shifts: intervals, busy: intervals }), {
          maxLength: 4,
        })
        .map((ts) => ts.map((t, i) => technician(`t${i}`, t))),
      bays: fc
        .array(intervals, { maxLength: 4 })
        .map((bs) => bs.map((busy, i) => bay(`b${i}`, busy))),
    });
    const aSearch = fc
      .record({
        snapshot: aSnapshot,
        durationMinutes: fc.constantFrom(15, 45, 60, 90),
        earliest: quarter,
        latest: quarter,
      })
      .map(({ snapshot, durationMinutes, earliest, latest }) =>
        search(snapshot, {
          durationMinutes,
          earliestStart: DAY.start + earliest * 15 * MINUTE,
          latestStart: DAY.start + latest * 15 * MINUTE,
        }),
      );

    it('returns exactly the grid starts where a technician and a bay are both free', () => {
      fc.assert(
        fc.property(aSearch, (s) => {
          const returned = new Map(
            findBookableStarts(s).map((slot) => [slot.start, slot]),
          );
          for (const start of gridPoints(s.window, s.zone, s.gridMinutes)) {
            if (start < s.earliestStart || start > s.latestStart) {
              expect(returned.has(start)).toBe(false);
              continue;
            }
            const free = freeResourcesAt(s.snapshot, {
              start,
              end: start + s.durationMinutes * MINUTE,
            });
            const bookable =
              free.technicians.length > 0 && free.bays.length > 0;
            expect(returned.get(start)).toEqual(
              bookable
                ? {
                    start,
                    end: start + s.durationMinutes * MINUTE,
                    freeTechnicians: free.technicians.length,
                    freeBays: free.bays.length,
                  }
                : undefined,
            );
          }
        }),
      );
    });

    it('only calls a resource free inside opening hours (and a shift) and clear of bookings', () => {
      fc.assert(
        fc.property(aSnapshot, anInterval, (snapshot, slot) => {
          fc.pre(slot.end > slot.start);
          const free = freeResourcesAt(snapshot, slot);
          for (const t of free.technicians) {
            expect(contains(intersect(t.shifts, snapshot.opening), slot)).toBe(
              true,
            );
            for (const b of t.busy) expect(overlaps(slot, b)).toBe(false);
          }
          for (const b of free.bays) {
            expect(contains(normalize(snapshot.opening), slot)).toBe(true);
            for (const busy of b.busy) expect(overlaps(slot, busy)).toBe(false);
          }
        }),
      );
    });
  });
});
