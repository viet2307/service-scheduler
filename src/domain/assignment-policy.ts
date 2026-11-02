import { intersect, Interval, totalDuration } from './interval';
import { BayCandidate, TechnicianCandidate } from './slot-finder';

const bookedTime = (busy: readonly Interval[], day: Interval) =>
  totalDuration(intersect(busy, [day]));

// Code-unit order rather than localeCompare, so the ranking never depends on the runtime's locale.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Best first: fewest skills beyond the required one (keeps specialists free
 * for work only they can do), then fewest booked minutes on `day`, then id.
 */
export function rankTechnicians(
  candidates: readonly TechnicianCandidate[],
  day: Interval,
): TechnicianCandidate[] {
  return candidates
    .map((t) => ({ t, booked: bookedTime(t.busy, day) }))
    .sort(
      (a, b) =>
        a.t.extraSkillCount - b.t.extraSkillCount ||
        a.booked - b.booked ||
        byText(a.t.id, b.t.id),
    )
    .map(({ t }) => t);
}

/** Best first: fewest booked minutes on `day`, then name, then id. */
export function rankBays(
  candidates: readonly BayCandidate[],
  day: Interval,
): BayCandidate[] {
  return candidates
    .map((b) => ({ b, booked: bookedTime(b.busy, day) }))
    .sort(
      (x, y) =>
        x.booked - y.booked ||
        byText(x.b.name, y.b.name) ||
        byText(x.b.id, y.b.id),
    )
    .map(({ b }) => b);
}
