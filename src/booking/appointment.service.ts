import { ServiceInjectable } from '@/common/decorators';
import { AppError, ErrorCode } from '@/common/errors';
import { AppointmentRepository } from '@/persistence/repositories';

@ServiceInjectable()
export class AppointmentService {
  constructor(private readonly appointments: AppointmentRepository) {}

  async get(id: string) {
    const appointment = await this.appointments.findDetailedById(id);
    if (!appointment) throw AppError.notFound('appointment', id);
    return appointment;
  }

  /**
   * Cancels a confirmed appointment and returns its current representation. One that was already
   * cancelled is returned as it is, so a client retrying a cancel that timed out sees success rather
   * than a conflict. Completed and no-show appointments cannot be cancelled.
   */
  async cancel(id: string) {
    await this.appointments.cancel(id);
    // The response needs the joined representation anyway, and its status tells the cases apart.
    const appointment = await this.get(id);
    if (appointment.status !== 'CANCELLED') {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        `appointment ${id} is ${appointment.status} and cannot be cancelled`,
        { appointmentStatus: appointment.status },
      );
    }
    return appointment;
  }
}
