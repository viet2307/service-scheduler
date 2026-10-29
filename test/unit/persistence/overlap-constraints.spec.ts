import { DatabaseError } from 'pg';
import { classifyOverlap } from '@/persistence/overlap-constraints';
import { PgErrorCode } from '@/persistence/pg-errors';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new DatabaseError('failed', 0, 'error'), { code, constraint });

describe('classifyOverlap', () => {
  it.each([
    ['appointment_no_technician_overlap', 'technician', 'retry'],
    ['appointment_no_bay_overlap', 'bay', 'retry'],
    ['appointment_no_vehicle_overlap', 'vehicle', 'reject'],
    ['technician_shift_no_overlap', 'shift', 'reject'],
  ])('classifies %s', (constraint, resource, onBookingConflict) => {
    expect(
      classifyOverlap(pgError(PgErrorCode.EXCLUSION_VIOLATION, constraint)),
    ).toEqual({
      constraint,
      table: expect.any(String),
      resource,
      onBookingConflict,
    });
  });

  it('ignores unknown constraints, other SQLSTATEs and non-database errors', () => {
    expect(
      classifyOverlap(
        pgError(PgErrorCode.EXCLUSION_VIOLATION, 'something_else'),
      ),
    ).toBeUndefined();
    expect(
      classifyOverlap(pgError(PgErrorCode.EXCLUSION_VIOLATION)),
    ).toBeUndefined();
    expect(
      classifyOverlap(
        pgError(PgErrorCode.UNIQUE_VIOLATION, 'appointment_no_bay_overlap'),
      ),
    ).toBeUndefined();
    expect(
      classifyOverlap(new Error('appointment_no_bay_overlap')),
    ).toBeUndefined();
  });

  it('does not treat inherited object keys as constraint names', () => {
    expect(
      classifyOverlap(pgError(PgErrorCode.EXCLUSION_VIOLATION, 'toString')),
    ).toBeUndefined();
  });
});
