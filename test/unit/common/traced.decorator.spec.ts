import { SetMetadata } from '@nestjs/common';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { ServiceInjectable, Span } from '@/common/decorators';

const METADATA = 'test:metadata';

class BaseService {
  @SetMetadata(METADATA, 'kept')
  inherited(): string {
    return 'from base';
  }
}

@ServiceInjectable()
class BookingService extends BaseService {
  readonly prefix = 'booked';

  get label(): string {
    return this.prefix;
  }

  async book(id: string): Promise<string> {
    return `${this.prefix}:${await this.lookup(id)}`;
  }

  async lookup(id: string): Promise<string> {
    await Promise.resolve();
    return id;
  }

  fail(): never {
    throw new Error('sync failure');
  }

  async failLater(): Promise<never> {
    await Promise.resolve();
    throw new Error('async failure');
  }

  @Span('booking.insert_attempt')
  attempt(): number {
    return 1;
  }
}

describe('ServiceInjectable / Traced', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  const service = new BookingService();

  const spans = async () => {
    await provider.forceFlush();
    return exporter.getFinishedSpans();
  };

  beforeAll(() => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => exporter.reset());

  afterAll(() => {
    trace.disable();
    context.disable();
  });

  it('keeps behaviour and `this`, and nests spans of awaited calls', async () => {
    await expect(service.book('a1')).resolves.toBe('booked:a1');

    const [lookup, book] = await spans();
    expect(book.name).toBe('BookingService.book');
    expect(lookup.name).toBe('BookingService.lookup');
    expect(lookup.parentSpanContext?.spanId).toBe(book.spanContext().spanId);
  });

  it('traces inherited methods under the subclass name and keeps their metadata', async () => {
    expect(service.inherited()).toBe('from base');

    expect((await spans()).map((s) => s.name)).toEqual([
      'BookingService.inherited',
    ]);
    expect(
      Reflect.getMetadata(METADATA, BookingService.prototype.inherited),
    ).toBe('kept');
  });

  it('records sync and async failures and rethrows them', async () => {
    expect(() => service.fail()).toThrow('sync failure');
    await expect(service.failLater()).rejects.toThrow('async failure');

    const failed = await spans();
    expect(failed.map((s) => s.name)).toEqual([
      'BookingService.fail',
      'BookingService.failLater',
    ]);
    for (const span of failed) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.map((e) => e.name)).toContain('exception');
    }
  });

  it('honours an explicit @Span name without wrapping twice', async () => {
    expect(service.attempt()).toBe(1);
    expect((await spans()).map((s) => s.name)).toEqual([
      'booking.insert_attempt',
    ]);
  });

  it('leaves getters alone', async () => {
    expect(service.label).toBe('booked');
    expect(await spans()).toHaveLength(0);
  });
});
