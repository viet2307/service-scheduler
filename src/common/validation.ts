import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError, ErrorCode } from './errors';

export interface FieldError {
  field: string;
  messages: string[];
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parent?: string,
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(
        ErrorCode.VALIDATION_FAILED,
        'One or more fields are invalid',
        {
          errors: flattenValidationErrors(errors),
        },
      ),
  });
