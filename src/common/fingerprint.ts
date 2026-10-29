import { createHash } from 'node:crypto';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object' || value instanceof Date)
    return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(sortKeys(value)) ?? '';

/** Detects an Idempotency-Key reused with a different body. */
export const requestFingerprint = (body: unknown): string =>
  createHash('sha256').update(canonicalJson(body)).digest('hex');
