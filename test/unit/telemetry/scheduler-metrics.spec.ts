import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { SchedulerMetrics } from '@/telemetry/scheduler-metrics';

describe('SchedulerMetrics', () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });

  beforeAll(() => metrics.setGlobalMeterProvider(provider));

  afterAll(async () => {
    await provider.shutdown();
    metrics.disable();
  });

  const exported = async (name: string) => {
    await reader.forceFlush();
    const metric = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .findLast((m) => m.descriptor.name === name);
    if (!metric) throw new Error(`${name} was not exported`);
    return metric;
  };

  it('records slots returned per service type, without the dealership', async () => {
    const schedulerMetrics = new SchedulerMetrics();
    schedulerMetrics.slotsReturned(0, 'OIL_SERVICE');
    schedulerMetrics.slotsReturned(12, 'OIL_SERVICE');

    const metric = await exported('scheduler.availability.slots_returned');

    expect(metric.descriptor).toMatchObject({
      name: 'scheduler.availability.slots_returned',
      unit: '{slot}',
    });
    expect(metric.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(metric.dataPoints).toHaveLength(1);
    expect(metric.dataPoints[0].attributes).toEqual({
      service_type: 'OIL_SERVICE',
    });
    expect(metric.dataPoints[0].value).toMatchObject({ count: 2, sum: 12 });
  });

  it('counts booking outcomes per outcome and service type, without the dealership', async () => {
    const schedulerMetrics = new SchedulerMetrics();
    schedulerMetrics.bookingOutcome('confirmed', 'OIL_SERVICE');
    schedulerMetrics.bookingOutcome('confirmed', 'OIL_SERVICE');
    schedulerMetrics.bookingOutcome('slot_unavailable', 'OIL_SERVICE');

    const metric = await exported('scheduler.booking.outcome');
    expect(metric.descriptor.unit).toBe('{request}');
    expect(metric.dataPointType).toBe(DataPointType.SUM);
    expect(
      metric.dataPoints.map(({ attributes, value }) => ({ attributes, value })),
    ).toEqual([
      {
        attributes: { outcome: 'confirmed', service_type: 'OIL_SERVICE' },
        value: 2,
      },
      {
        attributes: {
          outcome: 'slot_unavailable',
          service_type: 'OIL_SERVICE',
        },
        value: 1,
      },
    ]);
  });
});
