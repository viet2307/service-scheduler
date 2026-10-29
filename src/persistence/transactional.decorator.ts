import { AnyMethod, preserveMetadata } from '@/common/decorators/metadata';
import { TransactionHost, TransactionOptions } from './transaction-host';

export function Transactional(options?: TransactionOptions): MethodDecorator {
  return (
    _target: object,
    _key: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    const original = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    descriptor.value = preserveMetadata(
      original as AnyMethod,
      function (this: unknown, ...args: unknown[]) {
        return TransactionHost.instance.run(
          () => original.apply(this, args),
          options,
        );
      },
    );
  };
}
