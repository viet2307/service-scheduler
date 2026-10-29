import { canonicalJson, requestFingerprint } from '@/common/fingerprint';

describe('requestFingerprint', () => {
  it('ignores key order at every depth', () => {
    const a = {
      vehicleId: 'v1',
      startAt: '2026-11-02T09:00:00+07:00',
      meta: { b: 1, a: [{ y: 1, x: 2 }] },
    };
    const b = {
      meta: { a: [{ x: 2, y: 1 }], b: 1 },
      startAt: '2026-11-02T09:00:00+07:00',
      vehicleId: 'v1',
    };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(requestFingerprint(a)).toBe(requestFingerprint(b));
  });

  it('treats equal instants as the same request once parsed to Date', () => {
    expect(
      requestFingerprint({ startAt: new Date('2026-11-02T09:00:00+07:00') }),
    ).toBe(requestFingerprint({ startAt: new Date('2026-11-02T02:00:00Z') }));
  });

  it('changes when any value changes', () => {
    expect(requestFingerprint({ vehicleId: 'v1' })).not.toBe(
      requestFingerprint({ vehicleId: 'v2' }),
    );
    expect(requestFingerprint([1, 2])).not.toBe(requestFingerprint([2, 1]));
  });

  it('is a SHA-256 hex digest', () => {
    expect(requestFingerprint({})).toMatch(/^[0-9a-f]{64}$/);
  });
});
