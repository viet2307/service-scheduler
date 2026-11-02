import { gridPoints } from './calendar';
import { contains, intersect, Interval, MINUTE, subtract } from './interval';

export interface TechnicianCandidate {
  readonly id: string;
  /** Skills beyond the one the service needs; booking keeps scarce specialists free by preferring fewer. */
  readonly extraSkillCount: number;
  readonly shifts: readonly Interval[];
  readonly busy: readonly Interval[];
}

export interface BayCandidate {
  readonly id: string;
  readonly name: string;
  readonly busy: readonly Interval[];
}

/** Everything needed to decide what is free in one window: qualified technicians, compatible bays and the opening hours. */
export interface Snapshot {
  readonly opening: readonly Interval[];
  readonly technicians: readonly TechnicianCandidate[];
  readonly bays: readonly BayCandidate[];
}

export interface FreeResources {
  readonly technicians: TechnicianCandidate[];
  readonly bays: BayCandidate[];
}

export interface BookableStart extends Interval {
  readonly freeTechnicians: number;
  readonly freeBays: number;
}

/** SD §5.2 step 4: a technician works only during shifts that fall in opening hours. */
export const technicianFreeTime = (
  technician: TechnicianCandidate,
  opening: readonly Interval[],
): Interval[] =>
  subtract(intersect(technician.shifts, opening), technician.busy);

export const bayFreeTime = (
  bay: BayCandidate,
  opening: readonly Interval[],
): Interval[] => subtract(opening, bay.busy);

/** The technicians and bays free for the whole of `slot`. Availability and booking both decide with this function. */
export function freeResourcesAt(
  snapshot: Snapshot,
  slot: Interval,
): FreeResources {
  return {
    technicians: snapshot.technicians.filter((t) =>
      contains(technicianFreeTime(t, snapshot.opening), slot),
    ),
    bays: snapshot.bays.filter((b) =>
      contains(bayFreeTime(b, snapshot.opening), slot),
    ),
  };
}

export interface SlotSearch {
  readonly snapshot: Snapshot;
  readonly durationMinutes: number;
  /** The local day searched. */
  readonly window: Interval;
  readonly zone: string;
  readonly gridMinutes: number;
  /** Lead time and horizon bound the start, both inclusive. */
  readonly earliestStart: number;
  readonly latestStart: number;
}

/** SD §5.2 step 5: every grid start where some technician **and** some bay are free for the whole duration. */
export function findBookableStarts(search: SlotSearch): BookableStart[] {
  const duration = search.durationMinutes * MINUTE;
  return gridPoints(search.window, search.zone, search.gridMinutes)
    .filter((t) => t >= search.earliestStart && t <= search.latestStart)
    .flatMap((start) => {
      const slot = { start, end: start + duration };
      const free = freeResourcesAt(search.snapshot, slot);
      return free.technicians.length && free.bays.length
        ? [
            {
              ...slot,
              freeTechnicians: free.technicians.length,
              freeBays: free.bays.length,
            },
          ]
        : [];
    });
}
