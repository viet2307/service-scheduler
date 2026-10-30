import { ApiExposeProperty } from '@/common/decorators';

export class BayDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty({ example: 'Bay 3 (EV)' })
  name: string;

  @ApiExposeProperty({ example: 'EV_HV' })
  bayType: string;

  @ApiExposeProperty({ description: 'Inactive bays are never assigned' })
  isActive: boolean;
}
