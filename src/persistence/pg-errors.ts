import { DatabaseError } from 'pg';

export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
} as const;

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode];

const TRANSIENT_CODES = new Set<string>([
  PgErrorCode.SERIALIZATION_FAILURE,
  PgErrorCode.DEADLOCK_DETECTED,
  PgErrorCode.LOCK_NOT_AVAILABLE,
  PgErrorCode.QUERY_CANCELED,
]);

// 08: connection exception, 53: insufficient resources, 57P0x: server shutting down or starting up.
const TRANSIENT_CLASSES = ['08', '53', '57P0'];

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export const isPgError = (
  error: unknown,
  code?: PgErrorCode,
): error is DatabaseError =>
  error instanceof DatabaseError && (code === undefined || error.code === code);

export const violatedConstraint = (error: unknown): string | undefined =>
  error instanceof DatabaseError ? error.constraint : undefined;

/** Failures a client can safely retry with the same Idempotency-Key. */
export function isTransientDatabaseError(error: unknown): boolean {
  if (error instanceof DatabaseError) {
    const code = error.code ?? '';
    return (
      TRANSIENT_CODES.has(code) ||
      TRANSIENT_CLASSES.some((prefix) => code.startsWith(prefix))
    );
  }
  if (!(error instanceof Error)) return false;
  const { code } = error as NodeJS.ErrnoException;
  return (
    (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) ||
    /timeout exceeded when trying to connect|Connection terminated/i.test(
      error.message,
    )
  );
}
