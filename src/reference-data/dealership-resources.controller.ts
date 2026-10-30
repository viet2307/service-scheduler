import { Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { BaseController } from '@/common/base.controller';
import { Api, ApiProblem } from '@/common/decorators';
import { IdParamDto } from '@/common/dto';
import { BayDto } from './dto/bay.dto';
import { TechnicianDto } from './dto/technician.dto';
import { ReferenceDataService } from './reference-data.service';

@Api({ path: 'dealerships' })
export class DealershipResourcesController extends BaseController {
  constructor(private readonly referenceData: ReferenceDataService) {
    super();
  }

  @Get(':id/technicians')
  @ApiOkResponse({
    type: TechnicianDto,
    isArray: true,
    description: "The dealership's technicians, active or not, ordered by name",
  })
  @ApiProblem(HttpStatus.NOT_FOUND)
  async listTechnicians(@Param() { id }: IdParamDto) {
    return this.toDto(
      await this.referenceData.listTechnicians(id),
      TechnicianDto,
    );
  }

  @Get(':id/bays')
  @ApiOkResponse({
    type: BayDto,
    isArray: true,
    description:
      "The dealership's service bays, active or not, ordered by name",
  })
  @ApiProblem(HttpStatus.NOT_FOUND)
  async listBays(@Param() { id }: IdParamDto) {
    return this.toDto(await this.referenceData.listBays(id), BayDto);
  }
}
