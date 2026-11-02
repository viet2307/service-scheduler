import { Module } from '@nestjs/common';
import { AppointmentRepository } from './appointment.repository';
import { BayRepository } from './bay.repository';
import { CustomerRepository } from './customer.repository';
import { DealershipRepository } from './dealership.repository';
import { ServiceTypeRepository } from './service-type.repository';
import { TechnicianRepository } from './technician.repository';
import { VehicleRepository } from './vehicle.repository';

const repositories = [
  AppointmentRepository,
  BayRepository,
  CustomerRepository,
  DealershipRepository,
  ServiceTypeRepository,
  TechnicianRepository,
  VehicleRepository,
];

@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
