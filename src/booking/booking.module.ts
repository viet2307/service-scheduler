import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/persistence/repositories';
import { AppointmentService } from './appointment.service';
import { AppointmentsController } from './appointments.controller';

@Module({
  imports: [RepositoriesModule],
  controllers: [AppointmentsController],
  providers: [AppointmentService],
})
export class BookingModule {}
