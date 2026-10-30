import { Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { BaseController } from '@/common/base.controller';
import { Api, ApiProblem } from '@/common/decorators';
import { IdParamDto } from '@/common/dto';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityDto } from './dto/availability.dto';

@Api({ path: 'dealerships' })
export class AvailabilityController extends BaseController {
  constructor(private readonly availability: AvailabilityService) {
    super();
  }

  @Get(':id/availability')
  @ApiOkResponse({
    type: AvailabilityDto,
    description:
      'Bookable start times on one local day. Advisory: a booking re-checks everything.',
  })
  @ApiProblem(HttpStatus.NOT_FOUND)
  async get(
    @Param() { id }: IdParamDto,
    @Query() { serviceTypeId, date }: AvailabilityQueryDto,
  ) {
    return this.toDto(
      await this.availability.getDay(id, serviceTypeId, date),
      AvailabilityDto,
    );
  }
}
