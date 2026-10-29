import { Module } from '@nestjs/common';
import { AppointmentRepository } from './appointment.repository';
import { BayRepository } from './bay.repository';
import { DealershipRepository } from './dealership.repository';
import { ServiceTypeRepository } from './service-type.repository';
import { TechnicianRepository } from './technician.repository';

const repositories = [
  AppointmentRepository,
  BayRepository,
  DealershipRepository,
  ServiceTypeRepository,
  TechnicianRepository,
];

@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
