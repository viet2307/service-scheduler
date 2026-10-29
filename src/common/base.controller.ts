import { ClassConstructor, plainToInstance } from 'class-transformer';
import type { Page } from './dto';

/** Only `@Expose()`d properties reach the client. */
export abstract class BaseController {
  protected toDto<T>(data: object[], dto: ClassConstructor<T>): T[];
  protected toDto<T>(data: object, dto: ClassConstructor<T>): T;
  protected toDto<T>(
    data: object | object[],
    dto: ClassConstructor<T>,
  ): T | T[] {
    return plainToInstance(dto, data, { excludeExtraneousValues: true });
  }

  protected toPage<T>(page: Page<object>, dto: ClassConstructor<T>): Page<T> {
    return { ...page, items: this.toDto(page.items, dto) };
  }
}
