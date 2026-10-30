import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceTypeId: string;

  @ApiProperty({
    format: 'date',
    example: '2026-11-02',
    description: "A day in the dealership's time zone",
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a calendar date' })
  date: string;
}
