import { type Clock, InjectClock } from '@/common/clock';
import {
  type BookingPolicy,
  InjectBookingPolicy,
} from '@/common/config/booking-policy';
import { ServiceInjectable } from '@/common/decorators';
import {
  bookableStartRange,
  findBookableStarts,
  Interval,
  localDateOf,
  localDayWindow,
  localDayWindows,
  nextBookableStarts,
  openingIntervals,
  Snapshot,
} from '@/domain';
import {
  AppointmentRepository,
  BayRepository,
  DealershipRepository,
  ServiceTypeRepository,
  TechnicianRepository,
} from '@/persistence/repositories';
import { SchedulerMetrics } from '@/telemetry/scheduler-metrics';

const toInterval = (row: { startAt: Date; endAt: Date }): Interval => ({
  start: row.startAt.getTime(),
  end: row.endAt.getTime(),
});

@ServiceInjectable()
export class AvailabilityService {
  constructor(
    private readonly dealerships: DealershipRepository,
    private readonly serviceTypes: ServiceTypeRepository,
    private readonly technicians: TechnicianRepository,
    private readonly bays: BayRepository,
    private readonly appointments: AppointmentRepository,
    @InjectClock() private readonly clock: Clock,
    @InjectBookingPolicy() private readonly policy: BookingPolicy,
    private readonly metrics: SchedulerMetrics,
  ) {}

  /** The only place that turns rows into a Snapshot, for any window. */
  async loadSnapshot(
    dealership: { id: string; timezone: string },
    serviceType: { requiredSkill: string; requiredBayType: string },
    window: Interval,
  ): Promise<Snapshot> {
    const range = { from: new Date(window.start), to: new Date(window.end) };
    const [hours, technicians, bays] = await Promise.all([
      this.dealerships.getOpeningHours(dealership.id),
      this.technicians.findQualified(
        dealership.id,
        serviceType.requiredSkill,
        range,
      ),
      this.bays.findCompatible(dealership.id, serviceType.requiredBayType),
    ]);
    const [busyTechnicians, busyBays] = await Promise.all([
      this.appointments.findBusyTechnicians(
        dealership.id,
        technicians.map((t) => t.id),
        range,
      ),
      this.appointments.findBusyBays(
        dealership.id,
        bays.map((b) => b.id),
        range,
      ),
    ]);

    return {
      opening: openingIntervals(hours, dealership.timezone, window),
      technicians: technicians.map((t) => ({
        id: t.id,
        extraSkillCount: t.extraSkillCount,
        shifts: t.shifts.map(toInterval),
        busy: busyTechnicians
          .filter((a) => a.technicianId === t.id)
          .map(toInterval),
      })),
      bays: bays.map((b) => ({
        id: b.id,
        name: b.name,
        busy: busyBays.filter((a) => a.bayId === b.id).map(toInterval),
      })),
    };
  }

  /** Bookable starts on one local day. A past day or one beyond the horizon has none, which is not an error. */
  async getDay(dealershipId: string, serviceTypeId: string, date: string) {
    const [dealership, serviceType] = await Promise.all([
      this.dealerships.getById(dealershipId),
      this.serviceTypes.getById(serviceTypeId),
    ]);
    const window = localDayWindow(date, dealership.timezone);
    const { earliestStart, latestStart } = bookableStartRange(
      this.clock.now().getTime(),
      this.policy,
    );

    const slots =
      window.end > earliestStart && window.start <= latestStart
        ? findBookableStarts({
            snapshot: await this.loadSnapshot(dealership, serviceType, window),
            durationMinutes: serviceType.durationMinutes,
            window,
            zone: dealership.timezone,
            gridMinutes: this.policy.slotGridMinutes,
            earliestStart,
            latestStart,
          })
        : [];
    this.metrics.slotsReturned(slots.length, serviceType.code);

    return {
      dealershipId,
      serviceTypeId,
      date,
      timeZone: dealership.timezone,
      slots: slots.map((slot) => ({
        startAt: new Date(slot.start),
        endAt: new Date(slot.end),
        freeTechnicians: slot.freeTechnicians,
        freeBays: slot.freeBays,
      })),
    };
  }

  /**
   * The alternatives of a 409: up to BOOKING_ALTERNATIVES bookable starts after `after`, searching at most
   * BOOKING_ALTERNATIVES_SEARCH_DAYS local days from its own and never past the horizon.
   * One snapshot covers every searched day, so the search costs the same queries as one day's.
   */
  async findAlternatives(
    dealership: { id: string; timezone: string },
    serviceType: {
      requiredSkill: string;
      requiredBayType: string;
      durationMinutes: number;
    },
    after: number,
  ): Promise<number[]> {
    const zone = dealership.timezone;
    const range = bookableStartRange(this.clock.now().getTime(), this.policy);
    const days = localDayWindows(
      localDateOf(after, zone),
      zone,
      this.policy.alternativesSearchDays,
    ).filter((day) => day.start <= range.latestStart);
    if (!this.policy.alternatives || !days.length) return [];

    const snapshot = await this.loadSnapshot(dealership, serviceType, {
      start: days[0].start,
      end: days[days.length - 1].end,
    });
    return nextBookableStarts(
      {
        snapshot,
        durationMinutes: serviceType.durationMinutes,
        zone,
        gridMinutes: this.policy.slotGridMinutes,
        ...range,
      },
      days,
      after,
      this.policy.alternatives,
    ).map((slot) => slot.start);
  }
}
