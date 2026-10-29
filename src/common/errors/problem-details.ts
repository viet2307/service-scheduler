import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  traceId?: string;
  [extension: string]: unknown;
}

export class FieldErrorDto {
  @ApiProperty({ example: 'startAt' })
  field: string;

  @ApiProperty({
    type: [String],
    example: ['startAt must be a valid ISO 8601 date string'],
  })
  messages: string[];
}

export class ProblemDetailsDto implements ProblemDetails {
  [extension: string]: unknown;

  @ApiProperty({
    example: 'https://scheduler.example.com/problems/validation-failed',
  })
  type: string;

  @ApiProperty({ example: 'Request validation failed' })
  title: string;

  @ApiProperty({ example: 400 })
  status: number;

  @ApiPropertyOptional()
  detail?: string;

  @ApiPropertyOptional({ example: '/v1/appointments' })
  instance?: string;

  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code: string;

  @ApiPropertyOptional({ example: '4bf92f3577b34da6a3ce929d0e0e4736' })
  traceId?: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  errors?: FieldErrorDto[];
}
