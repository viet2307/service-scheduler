import { DatabaseError } from 'pg';
import {
  isPgError,
  isTransientDatabaseError,
  PgErrorCode,
  violatedConstraint,
} from '@/persistence/pg-errors';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new DatabaseError('failed', 0, 'error'), { code, constraint });

describe('pg error helpers', () => {
  it('matches errors by SQLSTATE and exposes the violated constraint', () => {
    const error = pgError(
      PgErrorCode.EXCLUSION_VIOLATION,
      'appointment_no_technician_overlap',
    );

    expect(isPgError(error)).toBe(true);
    expect(isPgError(error, PgErrorCode.EXCLUSION_VIOLATION)).toBe(true);
    expect(isPgError(error, PgErrorCode.UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError(new Error('x'))).toBe(false);
    expect(violatedConstraint(error)).toBe('appointment_no_technician_overlap');
    expect(violatedConstraint(new Error('x'))).toBeUndefined();
  });

  it.each(['55P03', '57014', '40001', '40P01', '08006', '53300', '57P01'])(
    'treats %s as transient',
    (code) => expect(isTransientDatabaseError(pgError(code))).toBe(true),
  );

  it.each(['23P01', '23505', '23503', '42P01'])(
    'treats %s as permanent',
    (code) => expect(isTransientDatabaseError(pgError(code))).toBe(false),
  );

  it('treats connection failures as transient', () => {
    const refused = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      {
        code: 'ECONNREFUSED',
      },
    );
    expect(isTransientDatabaseError(refused)).toBe(true);
    expect(
      isTransientDatabaseError(
        new Error('timeout exceeded when trying to connect'),
      ),
    ).toBe(true);
    expect(isTransientDatabaseError(new Error('something else'))).toBe(false);
    expect(isTransientDatabaseError('nope')).toBe(false);
  });
});
