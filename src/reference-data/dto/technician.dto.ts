import { ApiExposeProperty } from '@/common/decorators';

export class TechnicianDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'Linh Tran' })
  displayName: string;

  @ApiExposeProperty({
    type: [String],
    example: ['EV_HV', 'GENERAL'],
    description: 'Skill codes, sorted',
  })
  skills: string[];

  @ApiExposeProperty({ description: 'Inactive technicians are never assigned' })
  isActive: boolean;
}
