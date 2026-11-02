import type { PinoLogger } from 'nestjs-pino';
import { DatabaseError } from 'pg';
import { AvailabilityService } from '@/availability/availability.service';
import { AppointmentService } from '@/booking/appointment.service';
import { BookingCommand, BookingService } from '@/booking/booking.service';
import { AppError, ErrorCode } from '@/common/errors';
import { Interval, Snapshot } from '@/domain';
import { PgErrorCode } from '@/persistence/pg-errors';
import {
  AppointmentRepository,
  CustomerRepository,
  DealershipRepository,
  ServiceTypeRepository,
  VehicleRepository,
} from '@/persistence/repositories';
import { TransactionHost } from '@/persistence/transaction-host';
import { SchedulerMetrics } from '@/telemetry/scheduler-metrics';
import { FixedClock } from '../../support/clock';

const utc = (iso: string) => Date.parse(iso);
/** Monday 2 November 2026 in Asia/Ho_Chi_Minh. */
const DAY: Interval = {
  start: utc('2026-11-01T17:00:00Z'),
  end: utc('2026-11-02T17:00:00Z'),
};
const KEY = 'key-1';
const FINGERPRINT = 'fingerprint-1';

const COMMAND: BookingCommand = {
  dealershipId: 'd1',
  customerId: 'c1',
  vehicleId: 'v1',
  serviceTypeId: 's1',
  startAt: new Date('2026-11-02T02:00:00Z'), // 09:00 local
};

const pgError = (code: string, constraint?: string) =>
  Object.assign(new DatabaseError('failed', 0, 'error'), { code, constraint });

/** The policy prefers the generalist and Bay 1; `taken` marks resources booked over the requested slot. */
const snapshot = (taken: string[] = []): Snapshot => {
  const busy = (id: string) =>
    taken.includes(id)
      ? [{ start: COMMAND.startAt.getTime(), end: DAY.end }]
      : [];
  return {
    opening: [
      { start: utc('2026-11-02T01:00:00Z'), end: utc('2026-11-02T10:30:00Z') },
    ],
    technicians: [
      {
        id: 'specialist',
        extraSkillCount: 2,
        shifts: [DAY],
        busy: busy('specialist'),
      },
      {
        id: 'generalist',
        extraSkillCount: 0,
        shifts: [DAY],
        busy: busy('generalist'),
      },
    ],
    bays: [
      { id: 'b1', name: 'Bay 1', busy: busy('b1') },
      { id: 'b2', name: 'Bay 2', busy: busy('b2') },
    ],
  };
};

const lostRace = {
  technician: () =>
    pgError(
      PgErrorCode.EXCLUSION_VIOLATION,
      'appointment_no_technician_overlap',
    ),
  bay: () =>
    pgError(PgErrorCode.EXCLUSION_VIOLATION, 'appointment_no_bay_overlap'),
  deadlock: () => pgError(PgErrorCode.DEADLOCK_DETECTED),
};

const detailed = (id: string) => ({
  id,
  status: 'CONFIRMED',
  serviceType: { code: 'OIL_SERVICE', durationMinutes: 60 },
  technician: { id: 'generalist', displayName: 'Generalist' },
  bay: { id: 'b1', name: 'Bay 1' },
});

function setup() {
  const appointments = {
    findByIdempotencyKey: jest.fn().mockResolvedValue(undefined),
    hasVehicleOverlap: jest.fn().mockResolvedValue(false),
    lockForBooking: jest.fn().mockResolvedValue(undefined),
    insertIfKeyIsNew: jest.fn().mockResolvedValue({ id: 'a1' }),
  };
  const dealerships = {
    getById: jest.fn().mockResolvedValue({
      id: 'd1',
      timezone: 'Asia/Ho_Chi_Minh',
    }),
    getOpeningHours: jest
      .fn()
      .mockResolvedValue([
        { isoWeekday: 1, opensAt: '08:00', closesAt: '17:30' },
      ]),
  };
  const serviceTypes = {
    getById: jest.fn().mockResolvedValue({
      id: 's1',
      code: 'OIL_SERVICE',
      durationMinutes: 60,
      requiredSkill: 'GENERAL',
      requiredBayType: 'LIFT',
    }),
  };
  const customers = {
    getById: jest.fn().mockResolvedValue({
      id: 'c1',
      fullName: 'Ngoc Anh Le',
      email: 'anh@example.com',
      phone: '+84 90 000 0000',
    }),
  };
  const vehicles = {
    getById: jest.fn().mockResolvedValue({
      id: 'v1',
      customerId: 'c1',
      vin: 'WVWZZZ1KZAW000001',
    }),
  };
  const availability = {
    loadSnapshot: jest.fn().mockResolvedValue(snapshot()),
  };
  const appointmentService = {
    get: jest.fn((id: string) => Promise.resolve(detailed(id))),
  };
  const transactions = {
    run: jest.fn((fn: () => Promise<unknown>) => fn()),
  };
  const metrics = {
    bookingOutcome: jest.fn(),
    conflictRetry: jest.fn(),
    bookingAttempts: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new BookingService(
    appointments as unknown as AppointmentRepository,
    dealerships as unknown as DealershipRepository,
    serviceTypes as unknown as ServiceTypeRepository,
    customers as unknown as CustomerRepository,
    vehicles as unknown as VehicleRepository,
    availability as unknown as AvailabilityService,
    appointmentService as unknown as AppointmentService,
    transactions as unknown as TransactionHost,
    new FixedClock(new Date('2026-10-20T00:00:00Z')),
    {
      slotGridMinutes: 15,
      minLeadMinutes: 30,
      horizonDays: 90,
      lockTimeoutMs: 2000,
      maxAttempts: 3,
    },
    metrics as unknown as SchedulerMetrics,
    logger as unknown as PinoLogger,
  );
  const book = (command: BookingCommand = COMMAND) =>
    service.book(command, KEY, FINGERPRINT);
  return {
    book,
    appointments,
    availability,
    vehicles,
    transactions,
    metrics,
    logger,
  };
}

describe('BookingService', () => {
  it('locks and inserts the best-ranked pair in a transaction with a lock timeout', async () => {
    const { book, appointments, transactions } = setup();

    await expect(book()).resolves.toEqual({
      appointment: detailed('a1'),
      replayed: false,
    });
    const values = {
      dealershipId: 'd1',
      customerId: 'c1',
      vehicleId: 'v1',
      serviceTypeId: 's1',
      technicianId: 'generalist',
      bayId: 'b1',
      startAt: new Date('2026-11-02T02:00:00Z'),
      endAt: new Date('2026-11-02T03:00:00Z'),
      idempotencyKey: KEY,
      requestFingerprint: FINGERPRINT,
    };
    expect(appointments.lockForBooking).toHaveBeenCalledWith(values);
    expect(appointments.insertIfKeyIsNew).toHaveBeenCalledWith(values);
    expect(
      appointments.lockForBooking.mock.invocationCallOrder[0],
    ).toBeLessThan(appointments.insertIfKeyIsNew.mock.invocationCallOrder[0]);
    expect(transactions.run).toHaveBeenCalledWith(expect.any(Function), {
      lockTimeoutMs: 2000,
    });
  });

  describe('idempotency', () => {
    it('replays a used key with the same request without re-deciding', async () => {
      const { book, appointments, availability } = setup();
      appointments.findByIdempotencyKey.mockResolvedValue({
        id: 'a0',
        requestFingerprint: FINGERPRINT,
      });

      await expect(book()).resolves.toEqual({
        appointment: detailed('a0'),
        replayed: true,
      });
      expect(availability.loadSnapshot).not.toHaveBeenCalled();
      expect(appointments.insertIfKeyIsNew).not.toHaveBeenCalled();
    });

    it('refuses a used key with a different request', async () => {
      const { book, appointments } = setup();
      appointments.findByIdempotencyKey.mockResolvedValue({
        id: 'a0',
        requestFingerprint: 'another request',
      });

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
      });
    });

    it.each([
      [
        'the vehicle pre-check',
        (s: ReturnType<typeof setup>) =>
          s.appointments.hasVehicleOverlap.mockResolvedValue(true),
      ],
      [
        'the candidate search',
        (s: ReturnType<typeof setup>) =>
          s.availability.loadSnapshot.mockResolvedValue(snapshot(['b1', 'b2'])),
      ],
    ])(
      'replays instead of answering 409 from %s when a request with the same key committed meanwhile',
      async (_, arrange) => {
        const s = setup();
        arrange(s);
        s.appointments.findByIdempotencyKey
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({ id: 'a9', requestFingerprint: FINGERPRINT });

        await expect(s.book()).resolves.toEqual({
          appointment: detailed('a9'),
          replayed: true,
        });
      },
    );

    it('replays when the insert finds the key taken by a concurrent request', async () => {
      const { book, appointments } = setup();
      appointments.insertIfKeyIsNew.mockResolvedValue(undefined);
      appointments.findByIdempotencyKey
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'a9', requestFingerprint: FINGERPRINT });

      await expect(book()).resolves.toEqual({
        appointment: detailed('a9'),
        replayed: true,
      });
    });
  });

  describe('a conflict on insert', () => {
    it('answers VEHICLE_ALREADY_BOOKED for the vehicle constraint, without retrying', async () => {
      const { book, appointments } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(
        pgError(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_vehicle_overlap',
        ),
      );

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.VEHICLE_ALREADY_BOOKED,
      });
      expect(appointments.insertIfKeyIsNew).toHaveBeenCalledTimes(1);
    });

    it('replays when the vehicle constraint was hit by a request with the same key', async () => {
      const { book, appointments } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(
        pgError(
          PgErrorCode.EXCLUSION_VIOLATION,
          'appointment_no_vehicle_overlap',
        ),
      );
      appointments.findByIdempotencyKey
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'a9', requestFingerprint: FINGERPRINT });

      await expect(book()).resolves.toMatchObject({ replayed: true });
    });

    it.each(Object.keys(lostRace) as (keyof typeof lostRace)[])(
      'retries a race lost on the %s with a re-read snapshot',
      async (resource) => {
        const { book, appointments, availability, metrics, logger } = setup();
        appointments.insertIfKeyIsNew
          .mockRejectedValueOnce(lostRace[resource]())
          .mockResolvedValueOnce({ id: 'a2' });
        // The winner took the generalist and Bay 1 together.
        availability.loadSnapshot
          .mockResolvedValueOnce(snapshot())
          .mockResolvedValueOnce(snapshot(['generalist', 'b1']));

        await expect(book()).resolves.toEqual({
          appointment: detailed('a2'),
          replayed: false,
        });
        expect(availability.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(appointments.insertIfKeyIsNew).toHaveBeenLastCalledWith(
          expect.objectContaining({ technicianId: 'specialist', bayId: 'b2' }),
        );
        expect(metrics.conflictRetry).toHaveBeenCalledWith(resource);
        expect(metrics.bookingAttempts).toHaveBeenCalledWith(2);
        // A retry is worth a warning even when the booking succeeds.
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            outcome: 'confirmed',
            attempts: 2,
            technician_id: 'specialist',
            bay_id: 'b2',
          }),
          'booking decision',
        );
      },
    );

    it('answers SLOT_UNAVAILABLE when the re-read finds no pair left', async () => {
      const { book, appointments, availability } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(lostRace.technician());
      availability.loadSnapshot
        .mockResolvedValueOnce(snapshot())
        .mockResolvedValueOnce(snapshot(['generalist', 'specialist']));

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.SLOT_UNAVAILABLE,
      });
      expect(appointments.insertIfKeyIsNew).toHaveBeenCalledTimes(1);
    });

    it('answers SLOT_UNAVAILABLE once every attempt is lost', async () => {
      const { book, appointments, availability, metrics } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(lostRace.bay());

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.SLOT_UNAVAILABLE,
      });
      expect(appointments.insertIfKeyIsNew).toHaveBeenCalledTimes(3);
      expect(availability.loadSnapshot).toHaveBeenCalledTimes(3);
      expect(metrics.conflictRetry).toHaveBeenCalledTimes(3);
      expect(metrics.bookingAttempts).toHaveBeenCalledWith(3);
    });

    it.each([
      ['a lock timeout', pgError(PgErrorCode.LOCK_NOT_AVAILABLE)],
      [
        'an unknown exclusion constraint',
        pgError(PgErrorCode.EXCLUSION_VIOLATION, 'something_else'),
      ],
    ])('propagates %s unchanged', async (_, error) => {
      const { book, appointments } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(error);

      await expect(book()).rejects.toBe(error);
    });
  });

  describe('refusals before the insert', () => {
    it('answers SLOT_UNAVAILABLE when no compatible bay is free', async () => {
      const { book, appointments, availability } = setup();
      availability.loadSnapshot.mockResolvedValue(snapshot(['b1', 'b2']));

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.SLOT_UNAVAILABLE,
      });
      expect(appointments.insertIfKeyIsNew).not.toHaveBeenCalled();
    });

    it('loads the whole local day, which the policy ranks by', async () => {
      const { book, availability } = setup();
      await book();
      expect(availability.loadSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        expect.objectContaining({ requiredSkill: 'GENERAL' }),
        DAY,
      );
    });

    it('answers BUSINESS_RULE_VIOLATED with the rule, before looking for resources', async () => {
      const { book, availability } = setup();

      await expect(
        book({ ...COMMAND, startAt: new Date('2026-11-02T02:07:00Z') }),
      ).rejects.toMatchObject({
        code: ErrorCode.BUSINESS_RULE_VIOLATED,
        extensions: { rule: 'OFF_GRID' },
      });
      expect(availability.loadSnapshot).not.toHaveBeenCalled();
    });

    it('answers BUSINESS_RULE_VIOLATED for a vehicle of another customer', async () => {
      const { book, vehicles } = setup();
      vehicles.getById.mockResolvedValue({ id: 'v1', customerId: 'c2' });

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.BUSINESS_RULE_VIOLATED,
        extensions: { rule: 'VEHICLE_NOT_OWNED' },
      });
    });

    it('answers VEHICLE_ALREADY_BOOKED from the pre-check', async () => {
      const { book, appointments, availability } = setup();
      appointments.hasVehicleOverlap.mockResolvedValue(true);

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.VEHICLE_ALREADY_BOOKED,
      });
      expect(availability.loadSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('decision log and outcome metric', () => {
    it('logs one info record per booking, with IDs only', async () => {
      const { book, logger } = setup();
      await book();

      expect(logger.info).toHaveBeenCalledTimes(1);
      const [record, message] = logger.info.mock.calls[0];
      expect(message).toBe('booking decision');
      expect(record).toEqual({
        dealership_id: 'd1',
        service_type: 'OIL_SERVICE',
        outcome: 'confirmed',
        attempts: 1,
        technician_id: 'generalist',
        bay_id: 'b1',
        duration_ms: expect.any(Number),
      });
      const logged = JSON.stringify(record);
      for (const personal of [
        'Ngoc Anh Le',
        'anh@example.com',
        '+84 90 000 0000',
        'WVWZZZ1KZAW000001',
      ])
        expect(logged).not.toContain(personal);
    });

    it.each([
      [
        'a replay',
        'info',
        'replayed',
        'OIL_SERVICE',
        (s: ReturnType<typeof setup>) =>
          s.appointments.findByIdempotencyKey.mockResolvedValue({
            id: 'a0',
            requestFingerprint: FINGERPRINT,
          }),
      ],
      [
        'a reused key',
        'warn',
        'key_reused',
        'unknown',
        (s: ReturnType<typeof setup>) =>
          s.appointments.findByIdempotencyKey.mockResolvedValue({
            id: 'a0',
            requestFingerprint: 'another request',
          }),
      ],
      [
        'an unknown vehicle',
        'warn',
        'not_found',
        'unknown',
        (s: ReturnType<typeof setup>) =>
          s.vehicles.getById.mockRejectedValue(
            new AppError(ErrorCode.NOT_FOUND),
          ),
      ],
      [
        'a vehicle conflict',
        'warn',
        'vehicle_conflict',
        'OIL_SERVICE',
        (s: ReturnType<typeof setup>) =>
          s.appointments.hasVehicleOverlap.mockResolvedValue(true),
      ],
      [
        'a lock timeout',
        'error',
        'error',
        'OIL_SERVICE',
        (s: ReturnType<typeof setup>) =>
          s.appointments.insertIfKeyIsNew.mockRejectedValue(
            pgError(PgErrorCode.LOCK_NOT_AVAILABLE),
          ),
      ],
    ])(
      'records %s once, at %s, as %s',
      async (_, level, outcome, serviceType, arrange) => {
        const s = setup();
        arrange(s);
        await s.book().catch(() => undefined);

        expect(s.metrics.bookingOutcome).toHaveBeenCalledTimes(1);
        expect(s.metrics.bookingOutcome).toHaveBeenCalledWith(
          outcome,
          serviceType,
        );
        const logs = [s.logger.info, s.logger.warn, s.logger.error];
        expect(logs.flatMap((log) => log.mock.calls)).toHaveLength(1);
        expect(
          s.logger[level as 'info' | 'warn' | 'error'],
        ).toHaveBeenCalledWith(
          expect.objectContaining({ outcome }),
          'booking decision',
        );
      },
    );

    it('records attempts only for bookings that reached the insert', async () => {
      const confirmed = setup();
      await confirmed.book();
      expect(confirmed.metrics.bookingAttempts).toHaveBeenCalledWith(1);

      const replayed = setup();
      replayed.appointments.findByIdempotencyKey.mockResolvedValue({
        id: 'a0',
        requestFingerprint: FINGERPRINT,
      });
      await replayed.book();
      expect(replayed.metrics.bookingAttempts).not.toHaveBeenCalled();
    });
  });
});
