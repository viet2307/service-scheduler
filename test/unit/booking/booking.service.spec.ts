import { DatabaseError } from 'pg';
import { AvailabilityService } from '@/availability/availability.service';
import { AppointmentService } from '@/booking/appointment.service';
import { BookingCommand, BookingService } from '@/booking/booking.service';
import { ErrorCode } from '@/common/errors';
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

const snapshot = (bayBusy: Interval[] = []): Snapshot => ({
  opening: [
    { start: utc('2026-11-02T01:00:00Z'), end: utc('2026-11-02T10:30:00Z') },
  ],
  technicians: [
    { id: 'specialist', extraSkillCount: 2, shifts: [DAY], busy: [] },
    { id: 'generalist', extraSkillCount: 0, shifts: [DAY], busy: [] },
  ],
  bays: [{ id: 'b1', name: 'Bay 1', busy: bayBusy }],
});

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
  const customers = { getById: jest.fn().mockResolvedValue({ id: 'c1' }) };
  const vehicles = {
    getById: jest.fn().mockResolvedValue({ id: 'v1', customerId: 'c1' }),
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
    },
  );
  const book = (command: BookingCommand = COMMAND) =>
    service.book(command, KEY, FINGERPRINT);
  return { book, appointments, availability, vehicles, transactions };
}

describe('BookingService', () => {
  it('inserts the best-ranked pair in a transaction with a lock timeout', async () => {
    const { book, appointments, transactions } = setup();

    await expect(book()).resolves.toEqual({
      appointment: detailed('a1'),
      replayed: false,
    });
    expect(appointments.insertIfKeyIsNew).toHaveBeenCalledWith({
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
    });
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

    it.each([
      'appointment_no_technician_overlap',
      'appointment_no_bay_overlap',
    ])('answers SLOT_UNAVAILABLE for %s', async (constraint) => {
      const { book, appointments } = setup();
      appointments.insertIfKeyIsNew.mockRejectedValue(
        pgError(PgErrorCode.EXCLUSION_VIOLATION, constraint),
      );

      await expect(book()).rejects.toMatchObject({
        code: ErrorCode.SLOT_UNAVAILABLE,
      });
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
      availability.loadSnapshot.mockResolvedValue(
        snapshot([{ start: COMMAND.startAt.getTime(), end: DAY.end }]),
      );

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
});
