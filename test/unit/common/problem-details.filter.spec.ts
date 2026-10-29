import {
  ArgumentsHost,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseError } from 'pg';
import type { Env } from '@/common/config/env';
import {
  AppError,
  ErrorCode,
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsFilter,
} from '@/common/errors';

function createHost(url = '/v1/appointments?page=2') {
  const response = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

const pgError = (code: string) =>
  Object.assign(new DatabaseError('database said no', 0, 'error'), { code });

describe('ProblemDetailsFilter', () => {
  const config = {
    get: () => 'https://problems.test',
  } as unknown as ConfigService<Env, true>;
  const filter = new ProblemDetailsFilter(config);

  beforeAll(() => Logger.overrideLogger(false));

  const render = (exception: unknown) => {
    const { host, response } = createHost();
    filter.catch(exception, host);
    return {
      response,
      body: response.json.mock.calls[0][0] as Record<string, unknown>,
    };
  };

  it('renders an AppError as problem+json with its catalog status and extensions', () => {
    const { response, body } = render(
      new AppError(ErrorCode.SLOT_UNAVAILABLE, 'No technician is free', {
        alternatives: ['2026-11-02T03:30:00.000Z'],
      }),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.type).toHaveBeenCalledWith(PROBLEM_CONTENT_TYPE);
    expect(body).toEqual({
      type: 'https://problems.test/slot-unavailable',
      title: 'Requested slot is not available',
      status: 409,
      code: 'SLOT_UNAVAILABLE',
      detail: 'No technician is free',
      instance: '/v1/appointments',
      alternatives: ['2026-11-02T03:30:00.000Z'],
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    expect(
      render(new NotFoundException('Cannot GET /v1/nope')).body,
    ).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /v1/nope',
    });
    expect(render(new PayloadTooLargeException()).body).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      title: 'Payload Too Large',
    });
  });

  it('keeps the status of errors thrown by express middleware', () => {
    const parseError = Object.assign(
      new SyntaxError('Unexpected token } in JSON'),
      {
        status: 400,
        expose: true,
      },
    );
    expect(render(parseError).body).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  });

  it.each(['55P03', '57014', '40001', '08006', '53300', '57P01'])(
    'answers 503 with Retry-After for transient database error %s',
    (code) => {
      const { response, body } = render(pgError(code));
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
      expect(body).toMatchObject({
        status: 503,
        code: 'TEMPORARILY_UNAVAILABLE',
      });
      expect(body.detail).toBeUndefined();
    },
  );

  it('hides the details of unexpected errors', () => {
    for (const error of [
      new Error('relation "secret" does not exist'),
      pgError('23505'),
      'boom',
    ]) {
      const { body } = render(error);
      expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(body)).not.toMatch(/secret|database said no|boom/);
    }
  });
});
