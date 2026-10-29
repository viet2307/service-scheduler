import { applyDecorators } from '@nestjs/common';
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiPropertyOptions,
} from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';

type TypeFn = () => abstract new (...args: never[]) => unknown;

const SCALARS = new Set<unknown>([
  String,
  Number,
  Boolean,
  Date,
  Object,
  BigInt,
]);

const isClass = (
  fn: unknown,
): fn is abstract new (...args: never[]) => unknown =>
  typeof fn === 'function' &&
  /^class[\s{]/.test(Function.prototype.toString.call(fn));

function nestedType(type: ApiPropertyOptions['type']): TypeFn | undefined {
  const candidate: unknown = Array.isArray(type) ? type[0] : type;
  if (typeof candidate !== 'function' || SCALARS.has(candidate))
    return undefined;
  return isClass(candidate) ? () => candidate : (candidate as TypeFn);
}

/** `nullable: true` also makes the property optional. */
export const ApiExposeProperty = (options: ApiPropertyOptions = {}) => {
  const isArray = options.isArray === true || Array.isArray(options.type);
  const each = isArray ? { each: true } : undefined;
  const typeFn = nestedType(options.type);
  const enumType = (options as { enum?: object }).enum;

  return applyDecorators(
    ...(options.nullable
      ? [ApiPropertyOptional(options), IsOptional()]
      : [ApiProperty(options)]),
    Expose(),
    ...(typeFn ? [Type(typeFn), ValidateNested(each)] : []),
    ...(isArray ? [IsArray()] : []),
    ...(enumType ? [IsEnum(enumType, each)] : []),
  );
};
