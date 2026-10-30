import { ApiExposeProperty } from '@/common/decorators';

export class SlotDto {
  @ApiExposeProperty({ description: 'UTC' })
  startAt: Date;

  @ApiExposeProperty({ description: 'UTC; the slot is [startAt, endAt)' })
  endAt: Date;

  @ApiExposeProperty({
    type: 'integer',
    example: 2,
    description: 'Qualified technicians free for the whole slot',
  })
  freeTechnicians: number;

  @ApiExposeProperty({
    type: 'integer',
    example: 1,
    description: 'Compatible bays free for the whole slot',
  })
  freeBays: number;
}

export class AvailabilityDto {
  @ApiExposeProperty({ format: 'uuid' })
  dealershipId: string;

  @ApiExposeProperty({ format: 'uuid' })
  serviceTypeId: string;

  @ApiExposeProperty({ format: 'date', example: '2026-11-02' })
  date: string;

  @ApiExposeProperty({
    example: 'Asia/Ho_Chi_Minh',
    description: "The dealership's IANA time zone, which `date` is local to",
  })
  timeZone: string;

  @ApiExposeProperty({
    type: [SlotDto],
    description:
      'Bookable starts on the local grid, in order. Empty for a past day or one beyond the booking horizon.',
  })
  slots: SlotDto[];
}
