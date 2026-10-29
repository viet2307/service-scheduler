export type AnyMethod = (...args: never[]) => unknown;

export function preserveMetadata<T extends AnyMethod>(
  source: AnyMethod,
  target: T,
): T {
  for (const key of Reflect.getMetadataKeys(source)) {
    const value: unknown = Reflect.getMetadata(key, source);
    Reflect.defineMetadata(key, value, target);
  }
  Object.defineProperty(target, 'name', { value: source.name });
  return target;
}
