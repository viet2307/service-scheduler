import {
  applyDecorators,
  Controller,
  ControllerOptions,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiProblem } from './api-response.decorator';

export interface ApiOptions {
  path: string;
  tags?: string[];
  version?: ControllerOptions['version'];
  problems?: HttpStatus[];
}

export const Api = ({
  path,
  tags = [path],
  version = '1',
  problems = [
    HttpStatus.BAD_REQUEST,
    HttpStatus.INTERNAL_SERVER_ERROR,
    HttpStatus.SERVICE_UNAVAILABLE,
  ],
}: ApiOptions) =>
  applyDecorators(
    Controller({ path, version }),
    ApiTags(...tags),
    ApiProblem(...problems),
  );
