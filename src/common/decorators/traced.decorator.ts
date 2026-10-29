import {
  type Span as OtelSpan,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { AnyMethod, preserveMetadata } from './metadata';

const TRACED = Symbol('traced');

function recordFailure(span: OtelSpan, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export function withSpan<T>(name: string, fn: (span: OtelSpan) => T): T {
  return trace.getTracer('service-scheduler').startActiveSpan(name, (span) => {
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        return result.then(
          (value: unknown) => {
            span.end();
            return value;
          },
          (error: unknown) => {
            recordFailure(span, error);
            span.end();
            throw error;
          },
        ) as T;
      }
      span.end();
      return result;
    } catch (error) {
      recordFailure(span, error);
      span.end();
      throw error;
    }
  });
}

function wrap(original: AnyMethod, spanName: string): AnyMethod {
  const traced = preserveMetadata(
    original,
    function (this: unknown, ...args: never[]) {
      return withSpan(spanName, () => original.apply(this, args));
    },
  );
  Reflect.defineMetadata(TRACED, true, traced);
  return traced;
}

export function Span(name?: string): MethodDecorator {
  return (
    target: object,
    key: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    const original = descriptor.value as AnyMethod;
    descriptor.value = wrap(
      original,
      name ?? `${target.constructor.name}.${String(key)}`,
    );
  };
}

/** Spans every method, inherited ones included, as `ClassName.method`. */
export function Traced(): ClassDecorator {
  return (target) => {
    const seen = new Set<string>(['constructor']);
    for (
      let proto: object | null = target.prototype as object;
      proto && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (seen.has(key)) continue;
        seen.add(key);
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        const method = descriptor?.value as unknown;
        if (typeof method !== 'function' || Reflect.getMetadata(TRACED, method))
          continue;
        Object.defineProperty(target.prototype, key, {
          ...descriptor,
          value: wrap(method as AnyMethod, `${target.name}.${key}`),
        });
      }
    }
  };
}
