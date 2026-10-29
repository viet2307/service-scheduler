import { ServiceInjectable } from '@/common/decorators';
import { AppError } from '@/common/errors';
import { AppointmentRepository } from '@/persistence/repositories';

@ServiceInjectable()
export class AppointmentService {
  constructor(private readonly appointments: AppointmentRepository) {}

  async get(id: string) {
    const appointment = await this.appointments.findDetailedById(id);
    if (!appointment) throw AppError.notFound('appointment', id);
    return appointment;
  }
}
