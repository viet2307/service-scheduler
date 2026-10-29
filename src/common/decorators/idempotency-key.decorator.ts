import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError, ErrorCode } from '../errors';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

const VALID_KEY = /^[\x21-\x7E]{1,255}$/;

interface HeaderReader {
  header(name: string): string | undefined;
}

export function extractIdempotencyKey(request: HeaderReader): string {
  const key = request.header(IDEMPOTENCY_KEY_HEADER)?.trim();
  if (!key) {
    throw new AppError(
      ErrorCode.IDEMPOTENCY_KEY_MISSING,
      `The ${IDEMPOTENCY_KEY_HEADER} header is required for this operation`,
    );
  }
  if (!VALID_KEY.test(key)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `${IDEMPOTENCY_KEY_HEADER} must be 1 to 255 visible ASCII characters`,
    );
  }
  return key;
}

/** Also documents the header in OpenAPI. */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    extractIdempotencyKey(context.switchToHttp().getRequest<Request>()),
  [
    (target, key) => {
      if (key === undefined) return;
      ApiHeader({
        name: IDEMPOTENCY_KEY_HEADER,
        required: true,
        description:
          'Client-generated key (e.g. a UUID). Retrying with the same key and body replays the original result.',
      })(target, key, Object.getOwnPropertyDescriptor(target, key)!);
    },
  ],
);
