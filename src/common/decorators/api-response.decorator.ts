import { STATUS_CODES } from 'node:http';
import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { PageMetaDto } from '../dto/page.dto';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsDto,
} from '../errors/problem-details';

export const ApiProblem = (...statuses: HttpStatus[]) =>
  applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: STATUS_CODES[status],
        content: {
          [PROBLEM_CONTENT_TYPE]: {
            schema: { $ref: getSchemaPath(ProblemDetailsDto) },
          },
        },
      }),
    ),
  );

export const ApiPageResponse = (dto: Type<unknown>) =>
  applyDecorators(
    ApiExtraModels(PageMetaDto, dto),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageMetaDto) },
          {
            type: 'object',
            required: ['items'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(dto) } },
            },
          },
        ],
      },
    }),
  );
