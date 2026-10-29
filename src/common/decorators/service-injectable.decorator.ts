import { applyDecorators, Injectable, InjectableOptions } from '@nestjs/common';
import { Traced } from './traced.decorator';

export const ServiceInjectable = (options?: InjectableOptions) =>
  applyDecorators(Injectable(options), Traced());
