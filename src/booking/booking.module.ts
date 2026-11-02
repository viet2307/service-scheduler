import { Module } from '@nestjs/common';
import { AvailabilityModule } from '@/availability/availability.module';
import { RepositoriesModule } from '@/persistence/repositories';
import { AppointmentService } from './appointment.service';
import { AppointmentsController } from './appointments.controller';
import { BookingService } from './booking.service';

@Module({
  imports: [RepositoriesModule, AvailabilityModule],
  controllers: [AppointmentsController],
  providers: [AppointmentService, BookingService],
})
export class BookingModule {}
