import fc from 'fast-check';
import {
  contains,
  intersect,
  Interval,
  normalize,
  overlaps,
  subtract,
  totalDuration,
  union,
} from '@/domain';

const iv = (start: number, end: number): Interval => ({ start, end });

/** Small coordinates, so generated intervals often touch, overlap or are empty. */
const anInterval = fc
  .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
  .map(([a, b]) => iv(Math.min(a, b), Math.max(a, b)));
const aSet = fc.array(anInterval, { maxLength: 8 });

/** Sorted, non-empty, disjoint and not touching. */
const isNormalised = (set: Interval[]) =>
  set.every((i, k) => i.start < i.end && (k === 0 || set[k - 1].end < i.start));

describe('interval algebra', () => {
  describe('overlaps', () => {
    it('treats touching intervals as not overlapping', () => {
      expect(overlaps(iv(0, 10), iv(10, 20))).toBe(false);
      expect(overlaps(iv(0, 10), iv(9, 20))).toBe(true);
      expect(overlaps(iv(0, 10), iv(2, 3))).toBe(true);
    });

    // Found by the "inside free time" property: [83, 83) counted as overlapping [0, 84).
    it('treats an empty interval as overlapping nothing, like PostgreSQL', () => {
      expect(overlaps(iv(0, 84), iv(83, 83))).toBe(false);
      expect(overlaps(iv(5, 5), iv(5, 5))).toBe(false);
    });
  });

  describe('normalize', () => {
    it('sorts, drops empty intervals and merges overlapping and touching ones', () => {
      expect(
        normalize([iv(30, 40), iv(5, 5), iv(10, 20), iv(0, 10), iv(15, 18)]),
      ).toEqual([iv(0, 20), iv(30, 40)]);
    });

    it('returns an empty set for empty input', () => {
      expect(normalize([])).toEqual([]);
    });
  });

  describe('intersect', () => {
    it('keeps only the instants in both sets', () => {
      expect(
        intersect([iv(0, 10), iv(20, 30)], [iv(5, 25), iv(28, 40)]),
      ).toEqual([iv(5, 10), iv(20, 25), iv(28, 30)]);
    });

    it('is empty when one side is empty or the sets only touch', () => {
      expect(intersect([], [iv(0, 10)])).toEqual([]);
      expect(intersect([iv(0, 10)], [iv(10, 20)])).toEqual([]);
    });
  });

  describe('subtract', () => {
    it('cuts busy time out of a window', () => {
      expect(
        subtract([iv(0, 100)], [iv(10, 20), iv(15, 30), iv(90, 120)]),
      ).toEqual([iv(0, 10), iv(30, 90)]);
    });

    it('leaves nothing when the busy time equals the window', () => {
      expect(subtract([iv(0, 10)], [iv(0, 10)])).toEqual([]);
    });

    it('handles empty inputs', () => {
      expect(subtract([], [iv(0, 10)])).toEqual([]);
      expect(subtract([iv(10, 20), iv(0, 10)], [])).toEqual([iv(0, 20)]);
    });

    it('lets one busy interval cut several free blocks', () => {
      expect(subtract([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([
        iv(0, 5),
        iv(25, 30),
      ]);
    });
  });

  describe('contains', () => {
    it('accepts an interval exactly equal to a free block', () => {
      expect(contains([iv(0, 10)], iv(0, 10))).toBe(true);
    });

    it('rejects an interval that sticks out of every block', () => {
      expect(contains([iv(0, 10), iv(20, 30)], iv(5, 25))).toBe(false);
      expect(contains([], iv(0, 1))).toBe(false);
    });
  });

  it('merges sets with union and measures them with totalDuration', () => {
    const merged = union([iv(0, 10)], [iv(10, 15), iv(20, 30)]);
    expect(merged).toEqual([iv(0, 15), iv(20, 30)]);
    expect(totalDuration(merged)).toBe(25);
    expect(totalDuration([iv(0, 10), iv(5, 15)])).toBe(15);
  });

  describe('properties', () => {
    it('every operation returns a normalised set', () => {
      fc.assert(
        fc.property(aSet, aSet, (a, b) => {
          for (const result of [
            normalize(a),
            union(a, b),
            intersect(a, b),
            subtract(a, b),
          ])
            expect(isNormalised(result)).toBe(true);
        }),
      );
    });

    it('intersect is commutative', () => {
      fc.assert(
        fc.property(aSet, aSet, (a, b) => {
          expect(intersect(a, b)).toEqual(intersect(b, a));
        }),
      );
    });

    it('free time and busy time partition the window', () => {
      fc.assert(
        fc.property(anInterval, aSet, (window, busy) => {
          const free = subtract([window], busy);
          const busyInWindow = intersect(busy, [window]);

          expect(union(free, busyInWindow)).toEqual(normalize([window]));
          expect(intersect(free, busy)).toEqual([]);
          expect(totalDuration(free) + totalDuration(busyInWindow)).toBe(
            window.end - window.start,
          );
        }),
      );
    });

    it('an interval inside free time overlaps no busy interval', () => {
      fc.assert(
        fc.property(anInterval, aSet, anInterval, (window, busy, candidate) => {
          fc.pre(candidate.end > candidate.start);
          if (contains(subtract([window], busy), candidate))
            for (const b of busy) expect(overlaps(candidate, b)).toBe(false);
        }),
      );
    });
  });
});
