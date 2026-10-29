import { Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { BaseController } from '@/common/base.controller';
import { Api, ApiProblem } from '@/common/decorators';
import { IdParamDto } from '@/common/dto';
import { AppointmentService } from './appointment.service';
import { AppointmentDto } from './dto/appointment.dto';

@Api({ path: 'appointments' })
export class AppointmentsController extends BaseController {
  constructor(private readonly appointments: AppointmentService) {
    super();
  }

  @Get(':id')
  @ApiOkResponse({
    type: AppointmentDto,
    description: 'The appointment in its current state, cancelled or not',
  })
  @ApiProblem(HttpStatus.NOT_FOUND)
  async get(@Param() { id }: IdParamDto) {
    return this.toDto(await this.appointments.get(id), AppointmentDto);
  }
}
