/** Half-open `[start, end)` in epoch milliseconds (ADR-7.3), so intervals that touch do not overlap. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Whether they share an instant; like PostgreSQL's `&&`, an empty interval overlaps nothing. */
export const overlaps = (a: Interval, b: Interval): boolean =>
  Math.max(a.start, b.start) < Math.min(a.end, b.end);

/**
 * Sorted, without empty intervals, and merged where they overlap **or touch**,
 * so back-to-back shifts form one free block (plan §5 item 5).
 */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, end),
      };
    } else {
      merged.push({ start, end });
    }
  }
  return merged;
}

export const union = (a: readonly Interval[], b: readonly Interval[]) =>
  normalize([...a, ...b]);

export function intersect(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const x = normalize(a);
  const y = normalize(b);
  const result: Interval[] = [];
  for (let i = 0, j = 0; i < x.length && j < y.length;) {
    const start = Math.max(x[i].start, y[j].start);
    const end = Math.min(x[i].end, y[j].end);
    if (start < end) result.push({ start, end });
    if (x[i].end < y[j].end) i++;
    else j++;
  }
  return result;
}

/** `from` with every instant of `remove` taken out. */
export function subtract(
  from: readonly Interval[],
  remove: readonly Interval[],
): Interval[] {
  const removed = normalize(remove);
  const result: Interval[] = [];
  let first = 0;
  for (const piece of normalize(from)) {
    while (first < removed.length && removed[first].end <= piece.start) first++;
    let start = piece.start;
    for (
      let k = first;
      k < removed.length && removed[k].start < piece.end;
      k++
    ) {
      if (removed[k].start > start)
        result.push({ start, end: removed[k].start });
      start = Math.max(start, removed[k].end);
    }
    if (start < piece.end) result.push({ start, end: piece.end });
  }
  return result;
}

/** Whether one interval of `set` holds all of `inner`. `set` must be normalised, as every function here returns it. */
export const contains = (set: readonly Interval[], inner: Interval): boolean =>
  set.some((i) => i.start <= inner.start && inner.end <= i.end);

export const totalDuration = (set: readonly Interval[]): number =>
  normalize(set).reduce((sum, i) => sum + i.end - i.start, 0);
