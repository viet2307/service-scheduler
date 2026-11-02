import fc from 'fast-check';
import {
  bookableStartRange,
  BookingRequest,
  checkBookingRules,
  findBookableStarts,
  gridPoints,
  localDayWindow,
  MINUTE,
  OpeningHours,
  openingIntervals,
  RuleViolation,
} from '@/domain';

const DAY = 24 * 60 * MINUTE;
const ZONE = 'Asia/Ho_Chi_Minh';
const utc = (iso: string) => Date.parse(iso);
const NOW = utc('2026-10-20T00:00:00Z');

const days = (
  isoWeekdays: number[],
  opensAt = '08:00',
  closesAt = '17:30',
): OpeningHours[] =>
  isoWeekdays.map((isoWeekday) => ({ isoWeekday, opensAt, closesAt }));

const MON_TO_SAT = days([1, 2, 3, 4, 5, 6]);

const check = (start: string, overrides: Partial<BookingRequest> = {}) =>
  checkBookingRules({
    start: utc(start),
    durationMinutes: 60,
    now: NOW,
    zone: ZONE,
    openingHours: MON_TO_SAT,
    policy: { slotGridMinutes: 15, minLeadMinutes: 30, horizonDays: 90 },
    ...overrides,
  });

describe('checkBookingRules', () => {
  it('accepts an on-grid start inside opening hours, within lead time and horizon', () => {
    expect(check('2026-11-02T02:00:00Z')).toEqual([]); // Monday 09:00 local
  });

  it('rejects a start off the local grid', () => {
    expect(check('2026-11-02T02:07:00Z')).toEqual([RuleViolation.OFF_GRID]);
  });

  describe('lead time', () => {
    const start = '2026-11-02T02:00:00Z';

    it('allows a start exactly the minimum lead time from now', () => {
      expect(check(start, { now: utc(start) - 30 * MINUTE })).toEqual([]);
    });

    it('rejects a start one minute sooner', () => {
      expect(check(start, { now: utc(start) - 29 * MINUTE })).toEqual([
        RuleViolation.TOO_SOON,
      ]);
    });

    it('rejects a start in the past', () => {
      expect(check(start, { now: utc(start) + DAY })).toEqual([
        RuleViolation.TOO_SOON,
      ]);
    });
  });

  describe('horizon', () => {
    const start = '2026-11-02T02:00:00Z';

    it('allows a start exactly at the horizon', () => {
      expect(check(start, { now: utc(start) - 90 * DAY })).toEqual([]);
    });

    it('rejects a start one minute beyond it', () => {
      expect(check(start, { now: utc(start) - 90 * DAY - MINUTE })).toEqual([
        RuleViolation.BEYOND_HORIZON,
      ]);
    });
  });

  describe('opening hours', () => {
    it.each([
      ['starts at opening time', '2026-11-02T01:00:00Z', []],
      ['ends exactly at closing time', '2026-11-02T09:30:00Z', []],
      [
        'starts before opening',
        '2026-11-02T00:45:00Z',
        [RuleViolation.OUTSIDE_OPENING_HOURS],
      ],
      [
        'crosses closing time',
        '2026-11-02T09:45:00Z',
        [RuleViolation.OUTSIDE_OPENING_HOURS],
      ],
      [
        'falls on a closed weekday (Sunday)',
        '2026-11-01T02:00:00Z',
        [RuleViolation.OUTSIDE_OPENING_HOURS],
      ],
    ])('a slot that %s', (_, start, expected) => {
      expect(check(start)).toEqual(expected);
    });

    it('rejects a slot crossing local midnight even when open around the clock', () => {
      const openAllDay = days([1, 2, 3, 4, 5, 6, 7], '00:00', '24:00');
      // 23:00 local on Monday for two hours.
      expect(
        check('2026-11-02T16:00:00Z', {
          openingHours: openAllDay,
          durationMinutes: 120,
        }),
      ).toEqual([RuleViolation.OUTSIDE_OPENING_HOURS]);
      expect(
        check('2026-11-02T16:00:00Z', { openingHours: openAllDay }),
      ).toEqual([]);
    });

    it('uses the offset in force on a DST change day', () => {
      const london = {
        zone: 'Europe/London',
        openingHours: days([7]),
        now: utc('2026-03-20T00:00:00Z'),
      };
      // Sunday 29 March 2026: 08:00 BST is 07:00 UTC.
      expect(check('2026-03-29T07:00:00Z', london)).toEqual([]);
      expect(check('2026-03-29T06:45:00Z', london)).toEqual([
        RuleViolation.OUTSIDE_OPENING_HOURS,
      ]);
    });
  });

  it('lists every rule broken, in a fixed order', () => {
    expect(
      check('2026-11-01T02:07:00Z', { now: utc('2026-11-01T02:00:00Z') }),
    ).toEqual([
      RuleViolation.OFF_GRID,
      RuleViolation.TOO_SOON,
      RuleViolation.OUTSIDE_OPENING_HOURS,
    ]);
  });

  // When every technician and bay is free, the search and the booking must agree on every grid
  // start; otherwise an advisor could pick an offered slot and be told it breaks a rule.
  it('agrees with the slot finder on every start when resources are free', () => {
    const halfHour = (n: number) =>
      `${String(Math.floor(n / 2)).padStart(2, '0')}:${n % 2 ? '30' : '00'}`;

    fc.assert(
      fc.property(
        fc.constantFrom(
          'UTC',
          'Asia/Ho_Chi_Minh',
          'Asia/Kathmandu',
          'Europe/London',
        ),
        fc.constantFrom('2026-03-29', '2026-10-25', '2026-11-02'),
        fc
          .tuple(
            fc.integer({ min: 0, max: 47 }),
            fc.integer({ min: 0, max: 47 }),
          )
          .filter(([a, b]) => a !== b),
        fc.constantFrom(5, 10, 15, 20, 30, 60),
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: -3 * 24 * 60, max: 24 * 60 }),
        (
          zone,
          date,
          [a, b],
          slotGridMinutes,
          quarters,
          minLeadMinutes,
          horizonDays,
          nowOffsetMinutes,
        ) => {
          const window = localDayWindow(date, zone);
          const openingHours = days(
            [1, 2, 3, 4, 5, 6, 7],
            halfHour(Math.min(a, b)),
            halfHour(Math.max(a, b)),
          );
          const policy = { slotGridMinutes, minLeadMinutes, horizonDays };
          const now = window.start + nowOffsetMinutes * MINUTE;
          const durationMinutes = quarters * 15;
          const offered = new Set(
            findBookableStarts({
              snapshot: {
                opening: openingIntervals(openingHours, zone, window),
                technicians: [
                  { id: 't', extraSkillCount: 0, shifts: [window], busy: [] },
                ],
                bays: [{ id: 'b', name: 'b', busy: [] }],
              },
              durationMinutes,
              window,
              zone,
              gridMinutes: slotGridMinutes,
              ...bookableStartRange(now, policy),
            }).map((slot) => slot.start),
          );

          for (const start of gridPoints(window, zone, slotGridMinutes)) {
            const violations = checkBookingRules({
              start,
              durationMinutes,
              now,
              zone,
              openingHours,
              policy,
            });
            expect(violations.length === 0).toBe(offered.has(start));
          }
        },
      ),
    );
  });
});
