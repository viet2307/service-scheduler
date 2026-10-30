import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createDatabase } from '@/persistence/database';
import { createMigrator } from '@/persistence/migrator';
import { createApp } from './support/app';
import { ProbeController } from './support/probe.controller';

const PROBLEM_JSON = /application\/problem\+json/;

describe('HTTP (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;
  const http = () => request(server);
  beforeAll(async () => {
    const db = createDatabase({ connectionString: process.env.DATABASE_URL! });
    await createMigrator(db).migrateToLatest();
    await db.destroy();

    app = await createApp({ controllers: [ProbeController] });
    server = app.getHttpServer();
  });

  afterAll(() => app.close());

  describe('health', () => {
    it('GET /health/live', () =>
      http().get('/health/live').expect(200, { status: 'ok' }));

    it('GET /health/ready checks the database and migrations', async () => {
      const res = await http().get('/health/ready').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        info: { lifecycle: { status: 'up' }, database: { status: 'up' } },
      });
    });
  });

  describe('problem+json errors', () => {
    it('answers unknown routes with 404 NOT_FOUND', async () => {
      const res = await http()
        .get('/v1/nothing-here?x=1')
        .expect(404)
        .expect('Content-Type', PROBLEM_JSON);
      expect(res.body).toEqual({
        type: 'https://scheduler.example.com/problems/not-found',
        title: 'Resource not found',
        status: 404,
        code: 'NOT_FOUND',
        detail: 'Cannot GET /v1/nothing-here?x=1',
        instance: '/v1/nothing-here',
      });
    });

    it('requires the Idempotency-Key header', async () => {
      const res = await http()
        .post('/v1/probes')
        .send({ name: 'Bay 1' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_MISSING' });
    });

    it('rejects unknown and invalid fields', async () => {
      const res = await http()
        .post('/v1/probes')
        .set('Idempotency-Key', randomUUID())
        .send({ name: 'x'.repeat(21), technicianId: 'not allowed' })
        .expect(400)
        .expect('Content-Type', PROBLEM_JSON);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      const errors = res.body.errors as { field: string }[];
      expect(errors.map((e) => e.field).sort()).toEqual([
        'name',
        'technicianId',
      ]);
    });

    it('rejects malformed JSON', async () => {
      const res = await http()
        .post('/v1/probes')
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json')
        .send('{"name":')
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('validates path and query parameters', async () => {
      const id = await http().get('/v1/probes/not-a-uuid').expect(400);
      expect(id.body.errors).toEqual([
        { field: 'id', messages: ['id must be a UUID'] },
      ]);
      const size = await http().get('/v1/probes?pageSize=1000').expect(400);
      expect(size.body.errors[0].field).toBe('pageSize');
    });

    it('returns 404 for a missing resource', async () => {
      const id = '01a16194-0000-7000-8000-0000000000ff';
      const res = await http().get(`/v1/probes/${id}`).expect(404);
      expect(res.body).toMatchObject({
        code: 'NOT_FOUND',
        detail: `probe ${id} was not found`,
      });
    });

    it('hides internal error details', async () => {
      const res = await http().get('/v1/probes/failure').expect(500);
      expect(res.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        title: 'Internal server error',
      });
      expect(JSON.stringify(res.body)).not.toContain('secret_table');
    });
  });

  describe('base controller', () => {
    it('creates, serialises and pages resources', async () => {
      const created = await http()
        .post('/v1/probes')
        .set('Idempotency-Key', randomUUID())
        .send({ name: '  Bay 3 (EV) ' })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Bay 3 (EV)',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      await http()
        .get(`/v1/probes/${created.body.id}`)
        .expect(200, created.body);

      const page = await http().get('/v1/probes?page=1&pageSize=1').expect(200);
      expect(page.body).toEqual({
        items: [created.body],
        total: 1,
        page: 1,
        pageSize: 1,
      });
    });

    it('echoes a valid X-Request-Id and generates one otherwise', async () => {
      await http()
        .get('/health/live')
        .set('X-Request-Id', 'req-123')
        .expect('X-Request-Id', 'req-123');
      const res = await http()
        .get('/health/live')
        .set('X-Request-Id', 'bad id with spaces');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sets security headers and hides the framework', async () => {
      const res = await http().get('/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('OpenAPI', () => {
    it('documents versioned routes, the Idempotency-Key header and problem responses', async () => {
      const { body } = await http().get('/docs/openapi.json').expect(200);

      const create = body.paths['/v1/probes'].post;
      expect(create.parameters).toContainEqual(
        expect.objectContaining({
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
        }),
      );
      expect(create.responses['400'].content).toHaveProperty(
        'application/problem+json',
      );
      expect(body.paths).toHaveProperty(['/health/ready']);
      expect(body.components.schemas).toHaveProperty('ProblemDetailsDto');
    });
  });
});

describe('Readiness without a database (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp({
      databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
    });
  });

  afterAll(() => app.close());

  it('answers 503 problem+json with Retry-After', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/health/ready')
      .expect(503)
      .expect('Retry-After', '1')
      .expect('Content-Type', PROBLEM_JSON);
    expect(res.body).toMatchObject({
      code: 'TEMPORARILY_UNAVAILABLE',
      checks: {
        database: { status: 'down', message: 'Database is unreachable' },
      },
    });
  });
});
