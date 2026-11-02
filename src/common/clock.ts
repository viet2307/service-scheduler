import { Inject, Injectable } from '@nestjs/common';

/** Every "now" in business logic comes from here, so tests can fix it. Database defaults such as created_at stay in SQL. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
export const InjectClock = () => Inject(CLOCK);

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
