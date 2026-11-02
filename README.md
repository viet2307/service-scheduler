# Unified Service Scheduler

Backend for booking vehicle service appointments at a dealership. A booking is confirmed only when **one qualified technician and one compatible service bay are both free for the whole service duration**, and PostgreSQL exclusion constraints guarantee that no technician, bay or vehicle is ever double-booked.

## Stack

| Concern       | Choice                                          |
| ------------- | ----------------------------------------------- |
| Runtime       | Node.js 24 LTS, TypeScript (strict)             |
| Framework     | NestJS 11 (Express adapter)                     |
| Database      | PostgreSQL 18, Kysely, hand-written SQL         |
| Observability | OpenTelemetry (traces, metrics), Pino (logs)    |
| Tests         | Jest, supertest, Testcontainers (PostgreSQL 18) |

## Getting started

Prerequisites: Node.js 24 (`nvm use`), npm 11 and Docker.

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run db:seed      # optional demo data
npm run start:dev
curl localhost:3000/health/ready
```

Swagger UI is served at http://localhost:3000/docs (JSON at `/docs/openapi.json`). The committed contract is [openapi.yaml](openapi.yaml).

## Endpoints

| Method and path                                                        | Purpose                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /v1/service-types`                                                | Service types with their duration, skill and bay type                                    |
| `GET /v1/dealerships/{id}/technicians`                                 | A dealership's technicians with their skills                                             |
| `GET /v1/dealerships/{id}/bays`                                        | A dealership's service bays                                                              |
| `GET /v1/dealerships/{id}/availability?serviceTypeId=&date=YYYY-MM-DD` | Bookable start times on one local day, with how many technicians and bays are still free |
| `GET /v1/appointments/{id}`                                            | One appointment, including a cancelled one                                               |
| `GET /health/live`                                                     | Liveness                                                                                 |
| `GET /health/ready`                                                    | Readiness: database reachable and every migration applied                                |

## Demo

`npm run db:seed` loads fictional demo data from [seeds/demo.sql](seeds/demo.sql). The ids are fixed, so the requests in [requests.http](requests.http) work as written. The seed is re-runnable and refuses to run when `NODE_ENV=production`; it is not a migration. With Docker, `docker compose --profile demo up` seeds after migrating.

## Scripts

| Script                     | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `npm run start:dev`        | Run the API in watch mode (reads `.env`)                       |
| `npm run build`            | Compile to `dist/`                                             |
| `npm run start:prod`       | Run the compiled API                                           |
| `npm run db:migrate`       | Apply pending SQL migrations from `migrations/`                |
| `npm run db:seed`          | Load the demo data from `seeds/demo.sql` (never in production) |
| `npm run db:codegen`       | Regenerate `src/persistence/database.types.ts` from the schema |
| `npm run openapi:generate` | Regenerate `openapi.yaml` (CI fails if it is out of date)      |
| `npm run lint`             | ESLint (type-aware)                                            |
| `npm run format:check`     | Prettier check                                                 |
| `npm run typecheck`        | `tsc --noEmit` over `src` and `test`                           |
| `npm test`                 | Unit tests (no I/O)                                            |
| `npm run test:integration` | Repository and migration tests on PostgreSQL 18 (Docker)       |
| `npm run test:e2e`         | HTTP tests through the Nest app (Docker)                       |

## Building blocks

New features are assembled from these pieces instead of re-solving the same concerns:

| Concern           | Use                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controllers       | `@Api({ path })` for a `/v1/<path>` controller with Swagger tags and problem responses. Extend `BaseController` and return `this.toDto(...)` / `this.toPage(...)`.            |
| DTOs              | `@ApiExposeProperty()` documents, exposes and validates a property in one decorator. `PageQueryDto`, `IdParamDto`, `@Trim()`, `@ToBoolean()`.                                 |
| Idempotent writes | `@IdempotencyKey()` requires and documents the `Idempotency-Key` header; `requestFingerprint(body)` detects a reused key with a different body.                               |
| Errors            | Throw `AppError` with an `ErrorCode`. `ProblemDetailsFilter` renders RFC 9457 `application/problem+json` with `code` and `traceId`, and never leaks database messages.        |
| Services          | `@ServiceInjectable()` = `@Injectable()` + a span per method (`@Span('name')` to rename one).                                                                                 |
| Repositories      | Extend `BaseRepository<'table'>` for `findById`, `getById`, `findByIds`, `existsById`, `insert`, `updateById` and `paginate`. `this.db` joins the active transaction.         |
| Transactions      | `@Transactional({ lockTimeoutMs })` or `TransactionHost.run(...)`. Nested calls join the outer transaction.                                                                   |
| Database errors   | `isPgError(error, PgErrorCode.EXCLUSION_VIOLATION)`, `violatedConstraint(error)`; lock timeouts, serialization failures and lost connections become `503` with `Retry-After`. |
| Migrations        | Forward-only `migrations/<timestamp>_<name>.sql`, applied by Kysely's `Migrator` under an advisory lock. `/health/ready` stays `503` until all are applied.                   |
| Configuration     | Typed and validated at startup (`src/common/config/env.ts`); see [.env.example](.env.example).                                                                                |
| Time and policy   | `@InjectClock()` for "now" and `@InjectBookingPolicy()` for the booking settings, never `new Date()` or `ConfigService` in business logic, so tests can fix both.             |
| Domain core       | `src/domain`: interval algebra, calendar and time zones (luxon), slot finder. Pure functions over epoch-millisecond intervals, property-tested, 95 % coverage gate in CI.     |

## Docker

```bash
docker compose up --build
```

| Service          | URL                    | Purpose                                     |
| ---------------- | ---------------------- | ------------------------------------------- |
| `api`            | http://localhost:3000  | The scheduler API                           |
| `migrate`        | —                      | Applies migrations, then exits              |
| `postgres`       | localhost:5432         | PostgreSQL 18.4 (`scheduler`/`scheduler`)   |
| `otel-collector` | localhost:4317 / 4318  | OTLP gRPC / HTTP receiver                   |
| `jaeger`         | http://localhost:16686 | Traces                                      |
| `prometheus`     | http://localhost:9090  | Metrics (pushed by the collector over OTLP) |

The image is multi-stage, runs as the unprivileged `node` user, ships only production dependencies and has a `HEALTHCHECK` on `/health/live`. The same image runs migrations with `node dist/persistence/migrate.js`; set `DATABASE_MIGRATION_URL` to run them as a DDL-capable role while the API keeps a DML-only one.

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main` and `v*.*.*` tags:

1. **verify**: lint, format check, type-check, unit tests with coverage, integration and e2e tests on PostgreSQL 18, build, and a check that `openapi.yaml` matches the code.
2. **image**: build the Docker image, smoke-test `/health/live`, scan it with Trivy (fails on fixable HIGH/CRITICAL). On `main` and tags it is pushed to `ghcr.io/<owner>/<repo>` with SBOM and provenance attestations.
3. **deploy**: runs the migrations as a one-off ECS task with the new image, then rolls the new image digest out to the ECS service and waits for it to stabilise. It runs on `main` only, and only when the repository variables below are set, so it stays inert until AWS is wired up.

| Repository variable   | Example                                     |
| --------------------- | ------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/gha-deploy` |
| `AWS_REGION`          | `ap-southeast-1`                            |
| `ECS_CLUSTER`         | `service-scheduler`                         |
| `ECS_SERVICE`         | `service-scheduler-api`                     |
| `ECS_TASK_FAMILY`     | `service-scheduler-api`                     |
| `ECS_SUBNETS`         | `subnet-0abc,subnet-0def`                   |
| `ECS_SECURITY_GROUPS` | `sg-0123`                                   |

The deploy role is assumed through GitHub OIDC (no long-lived keys). The task definition's container must be named `api` and needs registry credentials to pull from GHCR. Actions are pinned to commit SHAs and kept current by Dependabot.

## Project layout

```
src/
  main.ts            bootstrap; telemetry is registered first
  app.module.ts      root module: config, logging, database, health
  app.setup.ts       HTTP setup shared with the e2e tests
  common/            config, errors, decorators, DTOs, base controller, validation
  persistence/       Kysely, transactions, repositories, migrator, seeder
  reference-data/    service types, technicians and bays
  availability/      bookable start times
  booking/           appointments
  health/            liveness and readiness
  telemetry/         OpenTelemetry SDK
  openapi/           document builder and generator
  domain/            pure business rules (no framework imports; enforced by ESLint)
migrations/          timestamp-prefixed SQL migrations
seeds/               demo data (not migrations)
requests.http        example requests against the demo data
test/
  unit/              no I/O
  integration/       real PostgreSQL 18 via Testcontainers
  e2e/               HTTP through the Nest app (supertest)
```

See [AGENTS.md](AGENTS.md) for the rules every change (human or AI-generated) must follow.
