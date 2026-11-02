import { trace } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AvailabilityService } from '@/availability/availability.service';
import { type Clock, InjectClock } from '@/common/clock';
import {
  type BookingPolicy,
  InjectBookingPolicy,
} from '@/common/config/booking-policy';
import { ServiceInjectable, Span } from '@/common/decorators';
import { AppError, ErrorCode } from '@/common/errors';
import {
  checkBookingRules,
  formatLocal,
  freeResourcesAt,
  type Interval,
  localDateOf,
  localDayWindow,
  MINUTE,
  rankBays,
  rankTechnicians,
  RuleViolation,
} from '@/domain';
import {
  classifyOverlap,
  type OverlapResource,
} from '@/persistence/overlap-constraints';
import { isPgError, PgErrorCode } from '@/persistence/pg-errors';
import {
  AppointmentRepository,
  CustomerRepository,
  DealershipRepository,
  type NewAppointment,
  ServiceTypeRepository,
  VehicleRepository,
} from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import {
  type BookingOutcome,
  SchedulerMetrics,
} from '@/telemetry/scheduler-metrics';
import { AppointmentService } from './appointment.service';

/** A booking request, normalised so that spellings of the same request fingerprint alike. */
export interface BookingCommand {
  readonly dealershipId: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly serviceTypeId: string;
  readonly startAt: Date;
}

export type DetailedAppointment = Awaited<
  ReturnType<AppointmentService['get']>
>;

export interface BookingResult {
  readonly appointment: DetailedAppointment;
  /** True when the Idempotency-Key was already used with the same request. */
  readonly replayed: boolean;
}

/** What one request decided, filled in as it goes, so failures report as much as successes. */
interface BookingDecision {
  outcome: BookingOutcome;
  serviceTypeCode?: string;
  attempts: number;
  technicianId?: string;
  bayId?: string;
}

type InsertAttempt =
  | { result: 'confirmed'; id: string }
  | { result: 'key_taken' }
  | { result: 'vehicle_taken' }
  /** Another request took the technician or bay a moment ago; another pair may still be free. */
  | { result: 'lost_race'; resource: OverlapResource | 'deadlock' };

/** Undefined for anything that is not a booking conflict: it propagates (503 if transient, else 500). */
function classifyInsertFailure(error: unknown): InsertAttempt | undefined {
  // Inserts that arrive together can deadlock on the constraint indexes. The advisory locks make
  // this rare, and when it happens it is the same lost race.
  if (isPgError(error, PgErrorCode.DEADLOCK_DETECTED))
    return { result: 'lost_race', resource: 'deadlock' };
  const violation = classifyOverlap(error);
  if (violation?.onBookingConflict === 'retry')
    return { result: 'lost_race', resource: violation.resource };
  if (violation?.resource === 'vehicle') return { result: 'vehicle_taken' };
  return undefined;
}

/** Refusals a request with the same key, committed in the meantime, must turn into a replay. */
const CONFLICT_CODES = new Set([
  ErrorCode.SLOT_UNAVAILABLE,
  ErrorCode.VEHICLE_ALREADY_BOOKED,
]);

export const VEHICLE_NOT_OWNED = 'VEHICLE_NOT_OWNED';

const OUTCOME_BY_CODE: Partial<Record<ErrorCode, BookingOutcome>> = {
  [ErrorCode.SLOT_UNAVAILABLE]: 'slot_unavailable',
  [ErrorCode.VEHICLE_ALREADY_BOOKED]: 'vehicle_conflict',
  [ErrorCode.BUSINESS_RULE_VIOLATED]: 'rule_violated',
  [ErrorCode.NOT_FOUND]: 'not_found',
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: 'key_reused',
};

const outcomeOf = (error: unknown): BookingOutcome =>
  (error instanceof AppError && OUTCOME_BY_CODE[error.code]) || 'error';

/** Error is kept for 5xx, so alerts on error logs fire for faults; retries and refusals are warnings. */
const logLevelOf = ({ outcome, attempts }: BookingDecision) => {
  if (outcome === 'error') return 'error';
  const decided = outcome === 'confirmed' || outcome === 'replayed';
  return decided && attempts <= 1 ? 'info' : 'warn';
};

const describeSlot = (slot: Interval, zone: string) =>
  `${formatLocal(slot.start, zone)} to ${formatLocal(slot.end, zone)} on ${localDateOf(slot.start, zone)} (${zone})`;

function ruleViolated(
  rule: RuleViolation,
  slot: Interval,
  zone: string,
  policy: BookingPolicy,
): AppError {
  const detail = {
    [RuleViolation.OFF_GRID]: `Start times must be on the ${policy.slotGridMinutes}-minute grid of the local day; ${formatLocal(slot.start, zone)} (${zone}) is not`,
    [RuleViolation.TOO_SOON]: `Bookings must start at least ${policy.minLeadMinutes} minutes from now`,
    [RuleViolation.BEYOND_HORIZON]: `Bookings can start at most ${policy.horizonDays} days ahead`,
    [RuleViolation.OUTSIDE_OPENING_HOURS]: `${describeSlot(slot, zone)} is outside the dealership's opening hours`,
  }[rule];
  return new AppError(ErrorCode.BUSINESS_RULE_VIOLATED, detail, { rule });
}

const slotUnavailable = (slot: Interval, zone: string) =>
  new AppError(
    ErrorCode.SLOT_UNAVAILABLE,
    `No qualified technician and compatible bay are both free from ${describeSlot(slot, zone)}`,
  );

const vehicleAlreadyBooked = (
  vehicleId: string,
  slot: Interval,
  zone: string,
) =>
  new AppError(
    ErrorCode.VEHICLE_ALREADY_BOOKED,
    `Vehicle ${vehicleId} already has an appointment overlapping ${describeSlot(slot, zone)}`,
  );

const toWindow = (slot: Interval) => ({
  from: new Date(slot.start),
  to: new Date(slot.end),
});

/** The exclusion constraints make the final decision; everything before them only explains a refusal precisely. */
@ServiceInjectable()
export class BookingService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly dealerships: DealershipRepository,
    private readonly serviceTypes: ServiceTypeRepository,
    private readonly customers: CustomerRepository,
    private readonly vehicles: VehicleRepository,
    private readonly availability: AvailabilityService,
    private readonly appointmentService: AppointmentService,
    private readonly transactions: TransactionHost,
    @InjectClock() private readonly clock: Clock,
    @InjectBookingPolicy() private readonly policy: BookingPolicy,
    private readonly metrics: SchedulerMetrics,
    @InjectPinoLogger(BookingService.name)
    private readonly logger: PinoLogger,
  ) {}

  @Span('booking.create')
  async book(
    command: BookingCommand,
    key: string,
    fingerprint: string,
  ): Promise<BookingResult> {
    const startedAt = performance.now();
    const decision: BookingDecision = { outcome: 'error', attempts: 0 };
    try {
      return await this.#decide(command, key, fingerprint, decision);
    } catch (error) {
      decision.outcome = outcomeOf(error);
      throw error;
    } finally {
      trace.getActiveSpan()?.setAttributes({
        'dealership.id': command.dealershipId,
        'service_type.code': decision.serviceTypeCode,
        'idempotency.replayed': decision.outcome === 'replayed',
      });
      this.metrics.bookingOutcome(
        decision.outcome,
        decision.serviceTypeCode ?? 'unknown',
      );
      if (decision.attempts > 0)
        this.metrics.bookingAttempts(decision.attempts);
      // One wide record explains the whole booking. IDs only, never names, VIN or contact details.
      this.logger[logLevelOf(decision)](
        {
          dealership_id: command.dealershipId,
          service_type: decision.serviceTypeCode,
          outcome: decision.outcome,
          attempts: decision.attempts,
          technician_id: decision.technicianId,
          bay_id: decision.bayId,
          duration_ms: Math.round(performance.now() - startedAt),
        },
        'booking decision',
      );
    }
  }

  // ES private methods, so @ServiceInjectable does not wrap them in spans of their own.
  async #decide(
    command: BookingCommand,
    key: string,
    fingerprint: string,
    decision: BookingDecision,
  ): Promise<BookingResult> {
    const existing = await this.appointments.findByIdempotencyKey(key);
    if (existing) return this.replay(existing, fingerprint, decision);
    try {
      return await this.#bookNew(command, key, fingerprint, decision);
    } catch (error) {
      // A request with the same key can commit after the lookup above. Its twin may then see the
      // vehicle or the last pair as taken, and must replay instead of answering 409.
      if (error instanceof AppError && CONFLICT_CODES.has(error.code)) {
        const committed = await this.appointments.findByIdempotencyKey(key);
        if (committed) return this.replay(committed, fingerprint, decision);
      }
      throw error;
    }
  }

  async #bookNew(
    command: BookingCommand,
    key: string,
    fingerprint: string,
    decision: BookingDecision,
  ): Promise<BookingResult> {
    const { dealership, serviceType, vehicle, openingHours } =
      await this.loadReferenceData(command);
    decision.serviceTypeCode = serviceType.code;
    const zone = dealership.timezone;
    const start = command.startAt.getTime();
    const slot = { start, end: start + serviceType.durationMinutes * MINUTE };

    if (vehicle.customerId !== command.customerId) {
      throw new AppError(
        ErrorCode.BUSINESS_RULE_VIOLATED,
        `Vehicle ${vehicle.id} does not belong to customer ${command.customerId}`,
        { rule: VEHICLE_NOT_OWNED },
      );
    }
    const [violation] = checkBookingRules({
      start,
      durationMinutes: serviceType.durationMinutes,
      now: this.clock.now().getTime(),
      zone,
      openingHours,
      policy: this.policy,
    });
    if (violation) throw ruleViolated(violation, slot, zone, this.policy);

    if (await this.appointments.hasVehicleOverlap(vehicle.id, toWindow(slot)))
      throw vehicleAlreadyBooked(vehicle.id, slot, zone);

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      // After a lost race this re-reads the snapshot instead of dropping only the resource named in
      // the error: the winner usually took both the technician and the bay. A loser
      // gets 23P01 only once the winner has committed, so the re-read already sees the winner.
      const pair = await this.findCandidates(dealership, serviceType, slot);
      if (!pair) throw slotUnavailable(slot, zone);
      Object.assign(decision, pair, { attempts: attempt });

      const result = await this.insertAttempt(
        {
          dealershipId: command.dealershipId,
          customerId: command.customerId,
          vehicleId: command.vehicleId,
          serviceTypeId: command.serviceTypeId,
          ...pair,
          startAt: new Date(slot.start),
          endAt: new Date(slot.end),
          idempotencyKey: key,
          requestFingerprint: fingerprint,
        },
        attempt,
      );
      switch (result.result) {
        case 'confirmed':
          decision.outcome = 'confirmed';
          return {
            appointment: await this.appointmentService.get(result.id),
            replayed: false,
          };
        case 'key_taken':
          return this.replayCommitted(key, fingerprint, decision);
        case 'vehicle_taken':
          throw vehicleAlreadyBooked(vehicle.id, slot, zone);
        case 'lost_race':
          this.metrics.conflictRetry(result.resource);
          continue;
      }
    }
    // Every lost attempt means a different winner committed, so running out means the capacity is gone.
    throw slotUnavailable(slot, zone);
  }

  @Span('booking.load_reference_data')
  private async loadReferenceData(command: BookingCommand) {
    const [dealership, serviceType, , vehicle, openingHours] =
      await Promise.all([
        this.dealerships.getById(command.dealershipId),
        this.serviceTypes.getById(command.serviceTypeId),
        this.customers.getById(command.customerId),
        this.vehicles.getById(command.vehicleId),
        this.dealerships.getOpeningHours(command.dealershipId),
      ]);
    return { dealership, serviceType, vehicle, openingHours };
  }

  /** The best free pair for the slot, ranked over the whole local day because the policy balances each day's workload. */
  @Span('booking.find_candidates')
  private async findCandidates(
    dealership: { id: string; timezone: string },
    serviceType: { requiredSkill: string; requiredBayType: string },
    slot: Interval,
  ): Promise<{ technicianId: string; bayId: string } | undefined> {
    const zone = dealership.timezone;
    const day = localDayWindow(localDateOf(slot.start, zone), zone);
    const snapshot = await this.availability.loadSnapshot(
      dealership,
      serviceType,
      day,
    );
    const free = freeResourcesAt(snapshot, slot);
    trace.getActiveSpan()?.setAttributes({
      'technicians.free': free.technicians.length,
      'bays.free': free.bays.length,
    });

    const [technician] = rankTechnicians(free.technicians, day);
    const [bay] = rankBays(free.bays, day);
    return technician && bay
      ? { technicianId: technician.id, bayId: bay.id }
      : undefined;
  }

  @Span('booking.insert_attempt')
  private async insertAttempt(
    values: NewAppointment,
    attempt: number,
  ): Promise<InsertAttempt> {
    const span = trace.getActiveSpan();
    span?.setAttribute('attempt', attempt);
    try {
      // The transaction holds only the advisory locks and the INSERT: no reads, no network calls (AGENTS.md rule 3).
      const row = await this.transactions.run(
        async () => {
          await this.appointments.lockForBooking(values);
          return this.appointments.insertIfKeyIsNew(values);
        },
        { lockTimeoutMs: this.policy.lockTimeoutMs },
      );
      span?.setAttribute('result', row ? 'confirmed' : 'key_taken');
      return row
        ? { result: 'confirmed', id: row.id }
        : { result: 'key_taken' };
    } catch (error) {
      const failure = classifyInsertFailure(error);
      if (!failure) throw error;
      span?.setAttribute(
        'result',
        failure.result === 'lost_race'
          ? `conflict:${failure.resource}`
          : 'conflict:vehicle',
      );
      return failure;
    }
  }

  /** The appointment's current representation, not the original response: only the row is stored. */
  private async replay(
    existing: { id: string; requestFingerprint: string },
    fingerprint: string,
    decision: BookingDecision,
  ): Promise<BookingResult> {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used with a different request',
      );
    }
    const appointment = await this.appointmentService.get(existing.id);
    Object.assign(decision, {
      outcome: 'replayed',
      serviceTypeCode: appointment.serviceType.code,
      technicianId: appointment.technician.id,
      bayId: appointment.bay.id,
    });
    return { appointment, replayed: true };
  }

  /** The insert found the key taken: a request with the same key committed in the meantime. */
  private async replayCommitted(
    key: string,
    fingerprint: string,
    decision: BookingDecision,
  ): Promise<BookingResult> {
    const committed = await this.appointments.findByIdempotencyKey(key);
    // Appointments are never deleted, so the row that took the key is still there.
    if (!committed)
      throw new Error('Idempotency-Key taken but no appointment holds it');
    return this.replay(committed, fingerprint, decision);
  }
}
