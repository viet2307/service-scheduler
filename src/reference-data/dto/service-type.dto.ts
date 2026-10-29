import { ApiExposeProperty } from '@/common/decorators';

export class ServiceTypeDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'EV_BATTERY_CHECK' })
  code: string;

  @ApiExposeProperty({ example: 'EV battery health check' })
  name: string;

  @ApiExposeProperty({
    type: 'integer',
    example: 90,
    description: 'Includes bay turnaround time',
  })
  durationMinutes: number;

  @ApiExposeProperty({
    example: 'EV_HV',
    description: 'Skill code the technician must hold',
  })
  requiredSkill: string;

  @ApiExposeProperty({
    example: 'EV_HV',
    description: 'Bay type code the bay must have',
  })
  requiredBayType: string;
}
