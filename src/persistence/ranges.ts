import { sql } from 'kysely';

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/**
 * The row's `[start_at, end_at)` overlaps the window, written exactly as the exclusion
 * constraints write it, so the planner can use their GiST indexes (evidence E1).
 */
export const overlapsRange = ({ from, to }: TimeWindow) =>
  sql<boolean>`tstzrange(start_at, end_at, '[)') && tstzrange(${from}, ${to}, '[)')`;
