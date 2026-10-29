import { HttpStatus } from '@nestjs/common';

export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  IDEMPOTENCY_KEY_MISSING = 'IDEMPOTENCY_KEY_MISSING',
  NOT_FOUND = 'NOT_FOUND',
  SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE',
  VEHICLE_ALREADY_BOOKED = 'VEHICLE_ALREADY_BOOKED',
  INVALID_STATE = 'INVALID_STATE',
  BUSINESS_RULE_VIOLATED = 'BUSINESS_RULE_VIOLATED',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  TEMPORARILY_UNAVAILABLE = 'TEMPORARILY_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ErrorDefinition {
  status: HttpStatus;
  title: string;
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorDefinition> = {
  [ErrorCode.VALIDATION_FAILED]: {
    status: HttpStatus.BAD_REQUEST,
    title: 'Request validation failed',
  },
  [ErrorCode.IDEMPOTENCY_KEY_MISSING]: {
    status: HttpStatus.BAD_REQUEST,
    title: 'Idempotency-Key header is required',
  },
  [ErrorCode.NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    title: 'Resource not found',
  },
  [ErrorCode.SLOT_UNAVAILABLE]: {
    status: HttpStatus.CONFLICT,
    title: 'Requested slot is not available',
  },
  [ErrorCode.VEHICLE_ALREADY_BOOKED]: {
    status: HttpStatus.CONFLICT,
    title: 'Vehicle already has an overlapping appointment',
  },
  [ErrorCode.INVALID_STATE]: {
    status: HttpStatus.CONFLICT,
    title: 'Resource is not in a valid state for this operation',
  },
  [ErrorCode.BUSINESS_RULE_VIOLATED]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: 'Business rule violated',
  },
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: 'Idempotency-Key was already used with a different request',
  },
  [ErrorCode.TEMPORARILY_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    title: 'Service temporarily unavailable',
  },
  [ErrorCode.INTERNAL_ERROR]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    title: 'Internal server error',
  },
};
