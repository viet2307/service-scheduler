import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

/** Must run before NestJS, express and pg are loaded so auto-instrumentation can patch them. */
export function startTelemetry(): void {
  if (sdk) return;
  const exporting = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'service-scheduler',
    ...(exporting
      ? {
          traceExporter: new OTLPTraceExporter(),
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter(),
            }),
          ],
        }
      : { spanProcessors: [], metricReaders: [] }),
    // Logs stay on stdout; pino only gets trace_id / span_id.
    logRecordProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
        // Middleware spans are noise, and express 5's `router` is already covered by the express instrumentation.
        '@opentelemetry/instrumentation-express': {
          ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
        },
        '@opentelemetry/instrumentation-router': { enabled: false },
        '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) =>
            req.url?.startsWith('/health') ?? false,
        },
      }),
    ],
  });
  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
