import { ERROR_CATALOG, ErrorCode } from './error-code';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(detail ?? ERROR_CATALOG[code].title, options);
    this.name = AppError.name;
  }

  get status(): number {
    return ERROR_CATALOG[this.code].status;
  }

  static notFound(resource: string, id: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, `${resource} ${id} was not found`);
  }
}
