import { randomUUID } from 'node:crypto';
import { Body, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { BaseController } from '@/common/base.controller';
import {
  Api,
  ApiExposeProperty,
  ApiPageResponse,
  ApiProblem,
  IdempotencyKey,
  Trim,
} from '@/common/decorators';
import { IdParamDto, PageQueryDto } from '@/common/dto';
import { AppError } from '@/common/errors';
import { requestFingerprint } from '@/common/fingerprint';

export class CreateProbeDto {
  @ApiExposeProperty({ example: 'Bay 3 (EV)' })
  @Trim()
  @IsString()
  @MaxLength(20)
  name: string;
}

export class ProbeDto {
  @ApiExposeProperty({ format: 'uuid' })
  id: string;

  @ApiExposeProperty()
  name: string;

  @ApiExposeProperty()
  fingerprint: string;
}

interface ProbeRecord extends ProbeDto {
  idempotencyKey: string;
}

/** Exercises the shared HTTP building blocks without any domain code. */
@Api({ path: 'probes' })
export class ProbeController extends BaseController {
  private readonly probes = new Map<string, ProbeRecord>();

  @Post()
  @ApiCreatedResponse({ type: ProbeDto })
  create(
    @Body() body: CreateProbeDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const probe = {
      id: randomUUID(),
      name: body.name,
      fingerprint: requestFingerprint(body),
      idempotencyKey,
    };
    this.probes.set(probe.id, probe);
    return this.toDto(probe, ProbeDto);
  }

  @Get()
  @ApiPageResponse(ProbeDto)
  list(@Query() { page, pageSize }: PageQueryDto) {
    const all = [...this.probes.values()];
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return this.toPage({ items, total: all.length, page, pageSize }, ProbeDto);
  }

  @Get('failure')
  fail(): never {
    throw new Error('relation "secret_table" does not exist');
  }

  @Get(':id')
  @ApiOkResponse({ type: ProbeDto })
  @ApiProblem(404)
  get(@Param() { id }: IdParamDto) {
    const probe = this.probes.get(id);
    if (!probe) throw AppError.notFound('probe', id);
    return this.toDto(probe, ProbeDto);
  }
}
