import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { Env } from './config/env';

const REQUEST_ID = /^[\w.-]{1,128}$/;

export function createLoggerParams(config: ConfigService<Env, true>): Params {
  const serviceName = config.get('OTEL_SERVICE_NAME', { infer: true });
  const env = config.get('NODE_ENV', { infer: true });
  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      base: { 'service.name': serviceName, env },
      transport: config.get('LOG_PRETTY', { infer: true })
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'request_id' },
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const id =
          typeof header === 'string' && REQUEST_ID.test(header)
            ? header
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Request bodies, headers and query strings may carry personal data; log identifiers only.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        return res.statusCode >= 400 ? 'warn' : 'info';
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    },
  };
}
