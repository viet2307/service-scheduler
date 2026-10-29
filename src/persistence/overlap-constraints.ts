import { Kysely, sql } from 'kysely';
import { isPgError, PgErrorCode, violatedConstraint } from './pg-errors';

export type OverlapResource = 'technician' | 'bay' | 'vehicle' | 'shift';

export interface OverlapConstraint {
  table: string;
  resource: OverlapResource;
  /** `retry`: another free resource may still fit. `reject`: no retry can fix it. */
  onBookingConflict: 'retry' | 'reject';
}

/** The only place that knows the exclusion constraint names; they are part of the error contract. */
export const OVERLAP_CONSTRAINTS = {
  appointment_no_technician_overlap: {
    table: 'appointment',
    resource: 'technician',
    onBookingConflict: 'retry',
  },
  appointment_no_bay_overlap: {
    table: 'appointment',
    resource: 'bay',
    onBookingConflict: 'retry',
  },
  appointment_no_vehicle_overlap: {
    table: 'appointment',
    resource: 'vehicle',
    onBookingConflict: 'reject',
  },
  technician_shift_no_overlap: {
    table: 'technician_shift',
    resource: 'shift',
    onBookingConflict: 'reject',
  },
} as const satisfies Record<string, OverlapConstraint>;

export type OverlapConstraintName = keyof typeof OVERLAP_CONSTRAINTS;

export interface OverlapViolation extends OverlapConstraint {
  constraint: OverlapConstraintName;
}

const NAMES = Object.keys(OVERLAP_CONSTRAINTS) as OverlapConstraintName[];

const isOverlapConstraintName = (
  name: string | undefined,
): name is OverlapConstraintName =>
  name !== undefined && Object.hasOwn(OVERLAP_CONSTRAINTS, name);

/** Undefined for anything but a 23P01 on a known constraint, which callers must treat as a bug. */
export function classifyOverlap(error: unknown): OverlapViolation | undefined {
  if (!isPgError(error, PgErrorCode.EXCLUSION_VIOLATION)) return undefined;
  const constraint = violatedConstraint(error);
  if (!isOverlapConstraintName(constraint)) return undefined;
  return { constraint, ...OVERLAP_CONSTRAINTS[constraint] };
}

/** A migration that drops or moves one of these would silently allow double booking. */
export async function missingConstraints<DB>(
  db: Kysely<DB>,
): Promise<OverlapConstraintName[]> {
  const { rows } = await sql<{ conname: string; relname: string }>`
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'x'
      and n.nspname = current_schema()
      and c.conname = any(${NAMES}::text[])
  `.execute(db);

  const present = new Set(
    rows.map(({ conname, relname }) => `${relname}.${conname}`),
  );
  return NAMES.filter(
    (name) => !present.has(`${OVERLAP_CONSTRAINTS[name].table}.${name}`),
  );
}
