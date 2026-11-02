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

  it('records slots returned per service type, without the dealership', async () => {
    const schedulerMetrics = new SchedulerMetrics();
    schedulerMetrics.slotsReturned(0, 'OIL_SERVICE');
    schedulerMetrics.slotsReturned(12, 'OIL_SERVICE');

    await reader.forceFlush();
    const [metric] = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics);

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
});
