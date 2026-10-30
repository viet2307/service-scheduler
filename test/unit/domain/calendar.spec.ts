import { DateTime } from 'luxon';
import {
  gridPoints,
  Interval,
  localDayWindow,
  OpeningHours,
  openingIntervals,
} from '@/domain';

const HOUR = 3_600_000;
const utc = (iso: string) => Date.parse(iso);
const span = (iso: [string, string]): Interval => ({
  start: utc(iso[0]),
  end: utc(iso[1]),
});
const local = (instant: number, zone: string) =>
  DateTime.fromMillis(instant, { zone }).toFormat('yyyy-MM-dd HH:mm');

const weekdays = (
  from: number,
  to: number,
  opensAt = '08:00',
  closesAt = '17:30',
) =>
  Array.from({ length: to - from + 1 }, (_, i): OpeningHours => ({
    isoWeekday: from + i,
    opensAt,
    closesAt,
  }));

describe('calendar', () => {
  describe('localDayWindow', () => {
    it.each([
      ['Asia/Ho_Chi_Minh', '2026-11-02', '2026-11-01T17:00:00Z', 24],
      ['Asia/Kathmandu', '2026-11-02', '2026-11-01T18:15:00Z', 24],
      ['Europe/London', '2026-03-29', '2026-03-29T00:00:00Z', 23],
      ['Europe/London', '2026-10-25', '2026-10-24T23:00:00Z', 25],
    ])('%s %s starts at %s and lasts %i hours', (zone, date, start, hours) => {
      const window = localDayWindow(date, zone);
      expect(window.start).toBe(utc(start));
      expect(window.end - window.start).toBe(hours * HOUR);
    });

    it.each([
      ['2026-02-30', 'Asia/Ho_Chi_Minh'],
      ['2026-11-02T10:00', 'Asia/Ho_Chi_Minh'],
      ['2026-11-02', 'Mars/Olympus_Mons'],
    ])('rejects %s in %s', (date, zone) => {
      expect(() => localDayWindow(date, zone)).toThrow(RangeError);
    });
  });

  describe('gridPoints', () => {
    it.each([
      ['2026-03-29', 92],
      ['2026-10-25', 100],
    ])(
      'covers the London DST day %s with %i local quarter hours',
      (date, count) => {
        const points = gridPoints(
          localDayWindow(date, 'Europe/London'),
          'Europe/London',
          15,
        );
        expect(points).toHaveLength(count);
        for (const t of points)
          expect(
            DateTime.fromMillis(t, { zone: 'Europe/London' }).minute % 15,
          ).toBe(0);
      },
    );

    it('aligns the grid to local midnight, not to UTC, at +05:45', () => {
      const zone = 'Asia/Kathmandu';
      const points = gridPoints(localDayWindow('2026-11-02', zone), zone, 30);

      expect(local(points[0], zone)).toBe('2026-11-02 00:00');
      expect(points).toContain(utc('2026-11-02T03:15:00Z')); // 09:00 local
      // On a UTC-aligned grid instead: 08:45 local
      expect(points).not.toContain(utc('2026-11-02T03:00:00Z'));
    });

    it('starts at the first grid point inside the window and excludes its end', () => {
      const zone = 'Asia/Ho_Chi_Minh';
      const points = gridPoints(
        span(['2026-11-02T02:05:00Z', '2026-11-02T03:00:00Z']),
        zone,
        30,
      );
      expect(points.map((t) => local(t, zone))).toEqual(['2026-11-02 09:30']);
    });

    it('walks every local day of a longer window', () => {
      const zone = 'Asia/Ho_Chi_Minh';
      const points = gridPoints(
        span(['2026-11-02T16:00:00Z', '2026-11-02T18:00:00Z']),
        zone,
        60,
      );
      expect(points.map((t) => local(t, zone))).toEqual([
        '2026-11-02 23:00',
        '2026-11-03 00:00',
      ]);
    });

    it('rejects an unknown zone', () => {
      expect(() =>
        gridPoints(
          span(['2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z']),
          'Nowhere',
          15,
        ),
      ).toThrow(RangeError);
    });
  });

  describe('openingIntervals', () => {
    it('maps local opening hours to UTC', () => {
      const zone = 'Asia/Ho_Chi_Minh';
      expect(
        openingIntervals(
          weekdays(1, 6),
          zone,
          localDayWindow('2026-11-02', zone),
        ),
      ).toEqual([span(['2026-11-02T01:00:00Z', '2026-11-02T10:30:00Z'])]);
    });

    it('uses the offset in force on each side of a DST change', () => {
      const zone = 'Europe/London';
      const weekend = {
        start: localDayWindow('2026-03-28', zone).start,
        end: localDayWindow('2026-03-29', zone).end,
      };
      expect(openingIntervals(weekdays(6, 7), zone, weekend)).toEqual([
        span(['2026-03-28T08:00:00Z', '2026-03-28T17:30:00Z']), // GMT
        span(['2026-03-29T07:00:00Z', '2026-03-29T16:30:00Z']), // BST
      ]);
      expect(
        openingIntervals(
          weekdays(7, 7),
          zone,
          localDayWindow('2026-10-25', zone),
        ),
      ).toEqual([span(['2026-10-25T08:00:00Z', '2026-10-25T17:30:00Z'])]);
    });

    it('is empty on a closed weekday', () => {
      const zone = 'Asia/Ho_Chi_Minh';
      expect(
        openingIntervals(
          weekdays(1, 6),
          zone,
          localDayWindow('2026-11-01', zone),
        ),
      ).toEqual([]);
    });

    it('accepts times with seconds and clips to the window', () => {
      const zone = 'Asia/Ho_Chi_Minh';
      expect(
        openingIntervals(
          weekdays(1, 1, '08:00:00', '17:30:00'),
          zone,
          span(['2026-11-02T05:00:00Z', '2026-11-03T05:00:00Z']),
        ),
      ).toEqual([span(['2026-11-02T05:00:00Z', '2026-11-02T10:30:00Z'])]);
    });
  });
});
