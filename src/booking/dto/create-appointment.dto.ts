import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dealershipId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ format: 'uuid', description: 'Owned by the customer' })
  @IsUUID()
  vehicleId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceTypeId: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-02T09:00:00+07:00',
    description:
      "With an explicit offset (`Z` or `±hh:mm`). On the slot grid of the dealership's local day, inside its opening hours.",
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'startAt must be an ISO 8601 date-time' },
  )
  // A time without an offset is ambiguous, so it is rejected rather than read as UTC or local.
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message: 'startAt must include a UTC offset (Z or ±hh:mm)',
  })
  startAt: string;
}
