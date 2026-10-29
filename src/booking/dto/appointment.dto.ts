import { ApiExposeProperty } from '@/common/decorators';

export enum AppointmentStatus {
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
}

export class AppointmentVehicleDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'WVWZZZ1KZAW000001' })
  vin: string;
}

export class AppointmentServiceTypeDto {
  @ApiExposeProperty({ example: 'EV_BATTERY_CHECK' })
  code: string;

  @ApiExposeProperty({ type: 'integer', example: 90 })
  durationMinutes: number;
}

export class AppointmentTechnicianDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'Linh Tran' })
  displayName: string;
}

export class AppointmentBayDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'Bay 3 (EV)' })
  name: string;
}

export class AppointmentDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({
    enum: AppointmentStatus,
    enumName: 'AppointmentStatus',
    example: AppointmentStatus.CONFIRMED,
  })
  status: AppointmentStatus;

  @ApiExposeProperty({ format: 'uuid' })
  dealershipId: string;

  @ApiExposeProperty({ format: 'uuid' })
  customerId: string;

  @ApiExposeProperty({ type: AppointmentVehicleDto })
  vehicle: AppointmentVehicleDto;

  @ApiExposeProperty({ type: AppointmentServiceTypeDto })
  serviceType: AppointmentServiceTypeDto;

  @ApiExposeProperty({ type: AppointmentTechnicianDto })
  technician: AppointmentTechnicianDto;

  @ApiExposeProperty({ type: AppointmentBayDto })
  bay: AppointmentBayDto;

  @ApiExposeProperty({ description: 'UTC' })
  startAt: Date;

  @ApiExposeProperty({ description: 'UTC; the interval is [startAt, endAt)' })
  endAt: Date;

  @ApiExposeProperty()
  createdAt: Date;

  @ApiExposeProperty({
    type: Date,
    nullable: true,
    description: 'Set only when status is CANCELLED',
  })
  cancelledAt: Date | null;
}
