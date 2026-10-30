import { DateTime } from 'luxon';
import { Interval, intersect, MINUTE } from './interval';

/** One weekday's opening hours as local wall-clock times, `HH:mm` or `HH:mm:ss`. */
export interface OpeningHours {
  readonly isoWeekday: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

/** `[local midnight, next local midnight)` of `date` (`YYYY-MM-DD`) in `zone`: 23 or 25 hours on a DST change day. */
export function localDayWindow(date: string, zone: string): Interval {
  const day = DateTime.fromISO(date, { zone }).startOf('day');
  if (!day.isValid || day.toISODate() !== date)
    throw new RangeError(`Invalid date ${date} or time zone ${zone}`);
  return { start: day.toMillis(), end: day.plus({ days: 1 }).toMillis() };
}

/** The local days that overlap `window`, each at its local midnight. */
function* localDays(window: Interval, zone: string): Generator<DateTime> {
  const first = DateTime.fromMillis(window.start, { zone }).startOf('day');
  if (!first.isValid) throw new RangeError(`Invalid time zone ${zone}`);
  for (
    let day = first;
    day.toMillis() < window.end;
    day = day.plus({ days: 1 })
  )
    yield day;
}

const atLocalTime = (day: DateTime, time: string): number => {
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return day.set({ hour, minute, second }).toMillis();
};

/** The dealership's opening hours inside `window`, as UTC intervals. */
export function openingIntervals(
  hours: readonly OpeningHours[],
  zone: string,
  window: Interval,
): Interval[] {
  const open: Interval[] = [];
  for (const day of localDays(window, zone))
    for (const h of hours)
      if (h.isoWeekday === day.weekday)
        open.push({
          start: atLocalTime(day, h.opensAt),
          end: atLocalTime(day, h.closesAt),
        });
  return intersect(open, [window]);
}

/**
 * The instants in `window` on a `gridMinutes` grid counted from each local midnight (plan §5 item 8),
 * so 09:00 is on the grid even at +05:45. Steps are absolute; since the grid divides 60 and DST
 * shifts are whole hours, every point is still on the local wall-clock grid on a DST change day.
 */
export function gridPoints(
  window: Interval,
  zone: string,
  gridMinutes: number,
): number[] {
  const step = gridMinutes * MINUTE;
  const points: number[] = [];
  for (const day of localDays(window, zone)) {
    const midnight = day.toMillis();
    const end = Math.min(day.plus({ days: 1 }).toMillis(), window.end);
    const first = midnight + Math.ceil((window.start - midnight) / step) * step;
    for (let t = Math.max(first, midnight); t < end; t += step) points.push(t);
  }
  return points;
}
