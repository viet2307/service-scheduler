import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { BaseController } from '@/common/base.controller';
import { Api, ApiProblem, IdempotencyKey } from '@/common/decorators';
import { IdParamDto } from '@/common/dto';
import { requestFingerprint } from '@/common/fingerprint';
import { AppointmentService } from './appointment.service';
import { BookingCommand, BookingService } from './booking.service';
import { AppointmentDto } from './dto/appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** UUIDs lower-cased and the start as an instant, so a retry that only spells the request differently replays instead of answering 422. */
const toCommand = (dto: CreateAppointmentDto): BookingCommand => ({
  dealershipId: dto.dealershipId.toLowerCase(),
  customerId: dto.customerId.toLowerCase(),
  vehicleId: dto.vehicleId.toLowerCase(),
  serviceTypeId: dto.serviceTypeId.toLowerCase(),
  startAt: new Date(dto.startAt),
});

@Api({ path: 'appointments' })
export class AppointmentsController extends BaseController {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly booking: BookingService,
  ) {
    super();
  }

  @Post()
  @ApiOperation({
    summary: 'Book a qualified technician and a compatible bay',
    description:
      'Assigns the technician and bay itself. Retrying with the same Idempotency-Key and request replays the booking instead of creating another.',
  })
  @ApiCreatedResponse({
    type: AppointmentDto,
    description: 'Booked',
    headers: {
      Location: {
        description: 'The new appointment',
        schema: { type: 'string', example: '/v1/appointments/{id}' },
      },
    },
  })
  @ApiOkResponse({
    type: AppointmentDto,
    description:
      "Replay: the Idempotency-Key was already used with the same request. Returns the appointment's current representation, which may have changed since (e.g. cancelled).",
    headers: {
      [IDEMPOTENT_REPLAYED_HEADER]: {
        schema: { type: 'string', enum: ['true'] },
      },
    },
  })
  @ApiProblem(
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
  )
  async create(
    @Body() dto: CreateAppointmentDto,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const command = toCommand(dto);
    const { appointment, replayed } = await this.booking.book(
      command,
      key,
      requestFingerprint({
        ...command,
        startAt: command.startAt.toISOString(),
      }),
    );
    if (replayed) {
      res.status(HttpStatus.OK).setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    } else {
      res
        .status(HttpStatus.CREATED)
        .location(`/v1/appointments/${appointment.id}`);
    }
    return this.toDto(appointment, AppointmentDto);
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

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an appointment',
    description:
      'Frees its technician, bay and vehicle at once; the appointment stays readable as CANCELLED. Cancelling an appointment that is already cancelled returns it unchanged, so a retry is safe without an Idempotency-Key.',
  })
  @ApiOkResponse({
    type: AppointmentDto,
    description: 'Cancelled, by this request or an earlier one',
  })
  @ApiProblem(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)
  async cancel(@Param() { id }: IdParamDto) {
    return this.toDto(await this.appointments.cancel(id), AppointmentDto);
  }
}
