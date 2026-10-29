import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { Request, Response } from 'express';
import { isTransientDatabaseError } from '@/persistence/pg-errors';
import type { Env } from '../config/env';
import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-code';
import { PROBLEM_CONTENT_TYPE, ProblemDetails } from './problem-details';

interface Problem {
  status: HttpStatus;
  code: string;
  title: string;
  detail?: string;
  extensions?: Record<string, unknown>;
}

interface ExposedHttpError {
  status: number;
  message: string;
  expose: true;
}

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.TEMPORARILY_UNAVAILABLE,
};

const fromCatalog = (code: ErrorCode, detail?: string): Problem => ({
  ...ERROR_CATALOG[code],
  code,
  detail,
});

const fromStatus = (status: HttpStatus, detail: string): Problem => {
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return fromCatalog(CODE_BY_STATUS[status] ?? ErrorCode.INTERNAL_ERROR);
  }
  const code = CODE_BY_STATUS[status];
  return code
    ? fromCatalog(code, detail)
    : {
        status,
        code: HttpStatus[status] ?? 'HTTP_ERROR',
        title: STATUS_CODES[status] ?? 'Request failed',
        detail,
      };
};

// Express middleware (e.g. the JSON body parser) throws http-errors instances rather than HttpExceptions.
const isExposedHttpError = (error: unknown): error is ExposedHttpError =>
  error instanceof Error &&
  (error as Partial<ExposedHttpError>).expose === true &&
  typeof (error as Partial<ExposedHttpError>).status === 'number';

const currentTraceId = (): string | undefined => {
  const context = trace.getActiveSpan()?.spanContext();
  return context && isSpanContextValid(context) ? context.traceId : undefined;
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);
  private readonly typeBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.typeBaseUrl = config.get('PROBLEM_TYPE_BASE_URL', { infer: true });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const { extensions, ...problem } = this.toProblem(exception);

    if (problem.status === HttpStatus.SERVICE_UNAVAILABLE) {
      this.logger.warn(exception);
      response.setHeader('Retry-After', '1');
    } else if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception);
    }

    const body: ProblemDetails = {
      type: `${this.typeBaseUrl}/${problem.code.toLowerCase().replaceAll('_', '-')}`,
      ...problem,
      instance: request.originalUrl.split('?')[0],
      traceId: currentTraceId(),
      ...extensions,
    };
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof AppError) {
      return {
        ...fromCatalog(exception.code, exception.detail),
        extensions: exception.extensions,
      };
    }
    if (exception instanceof HttpException) {
      return fromStatus(exception.getStatus(), exception.message);
    }
    if (isExposedHttpError(exception)) {
      return fromStatus(exception.status, exception.message);
    }
    if (isTransientDatabaseError(exception)) {
      return fromCatalog(ErrorCode.TEMPORARILY_UNAVAILABLE);
    }
    return fromCatalog(ErrorCode.INTERNAL_ERROR);
  }
}
