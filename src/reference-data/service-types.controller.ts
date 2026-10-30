import { Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { BaseController } from '@/common/base.controller';
import { Api } from '@/common/decorators';
import { ServiceTypeDto } from './dto/service-type.dto';
import { ReferenceDataService } from './reference-data.service';

@Api({ path: 'service-types' })
export class ServiceTypesController extends BaseController {
  constructor(private readonly referenceData: ReferenceDataService) {
    super();
  }

  @Get()
  @ApiOkResponse({
    type: ServiceTypeDto,
    isArray: true,
    description: 'Every service type, ordered by name',
  })
  async list() {
    return this.toDto(
      await this.referenceData.listServiceTypes(),
      ServiceTypeDto,
    );
  }
}
