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
| `POST /v1/appointments`                                                | Book: assigns a qualified technician and a compatible bay. Requires `Idempotency-Key`    |
| `GET /v1/appointments/{id}`                                            | One appointment, including a cancelled one                                               |
| `POST /v1/appointments/{id}/cancel`                                    | Cancel: frees its technician, bay and vehicle at once. Repeating it answers 200 again    |
| `GET /health/live`                                                     | Liveness                                                                                 |
| `GET /health/ready`                                                    | Readiness: database reachable and every migration applied                                |

## Demo

`npm run db:seed` loads fictional demo data from [seeds/demo.sql](seeds/demo.sql). The ids are fixed, so the requests in [requests.http](requests.http) work as written. The seed is re-runnable and refuses to run when `NODE_ENV=production`; it is not a migration. With Docker, `docker compose --profile demo up` seeds after migrating.

Two scripts walk through the API on that data. Both need `curl` and `jq`, and both cancel what they booked, so they can run again:

- `scripts/demo.sh [YYYY-MM-DD]`: availability, a booking, a replay with the same `Idempotency-Key`, the key reused for another request (`422`), the same slot filled until `409` with alternatives, then cancel and re-book. It waits for Enter between steps; `DEMO_NO_PAUSE=1` runs straight through.
- `scripts/race.sh [N]`: sends N bookings for the same slot at once, each for its own vehicle, counts the responses (exactly as many `201`s as the availability check says can fit, `409` for the rest) and runs [scripts/sql/reconcile-overlaps.sql](scripts/sql/reconcile-overlaps.sql) to show that nothing was double-booked. It also needs `psql`, or Docker Compose, to reach the database.

With the compose stack running, Jaeger shows each booking's spans (a lost race appears as a second `booking.insert_attempt`), and Prometheus shows the `scheduler_booking_*` series.

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
| Domain core       | `src/domain`: intervals, time zones (luxon), slot finder, booking rules, assignment policy. Pure functions on epoch-ms intervals, property-tested, 95 % coverage gate in CI.  |

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
scripts/            demo.sh and race.sh (see Demo)
scripts/sql/         operational queries, e.g. the hourly overlap reconciliation
requests.http        example requests against the demo data
test/
  unit/              no I/O
  integration/       real PostgreSQL 18 via Testcontainers
  e2e/               HTTP through the Nest app (supertest)
```

See [AGENTS.md](AGENTS.md) for the rules every change (human or AI-generated) must follow.

## AI Collaboration Narrative

I split the work by where judgement matters most. The system design, the architecture and every decision that shapes them are mine; there I used AI as a research assistant and as a critic of my own design. The code and the tests were written by an AI coding agent (Claude Code), inside rules I set and through reviews I did. Design research and the database verification scripts ran with Claude (claude.ai).

### Designing the system: my decisions, AI as researcher and critic

- **I framed the problem before looking at solutions.** Requirements became invariants, and for each invariant I asked one question: can two concurrent requests break it? The answer decided whether the database or the application enforces it. That is why double booking is ruled out by PostgreSQL exclusion constraints, not by application code.
- **I set the evidence bar.** A claim about PostgreSQL entered the design only after a script proved it on PostgreSQL 18.4, and decisions rest on primary sources rather than summaries. That rule changed the design several times. `INSERT … ON CONFLICT DO NOTHING` without a target silently skips a double booking, which became rule 1 in [AGENTS.md](AGENTS.md). PostgreSQL 18's `WITHOUT OVERLAPS` cannot ignore cancelled appointments, so I kept explicit `EXCLUDE` constraints. Range partitioning by time breaks those constraints, so they include `dealership_id` now, ready for hash partitioning later.
- **I asked for options and failure modes, not for an answer.** For concurrency, the AI laid out every approach (check then insert, row locks, `SERIALIZABLE`, a distributed lock, exclusion constraints) with how each one fails, and I chose. When a draft claimed that TypeORM's generated migrations would own the schema, I checked it against how a TypeORM project actually works: generated migrations can be edited by hand. The real risk was narrower, and the decision record was rewritten around it.
- **I use AI to attack my own design.** I regularly ask it to double-check a decision, to look for flaws, or to check one document against another: the implementation plan against the design, the design against the brief. Those reviews found real problems, such as a retry rule that would give up while technicians and bays were still free, and a trace-sampling scheme that contradicted itself. What to do with each finding was my call.
- **Every change to the design is a recorded decision.** The implementation plan logs each one as what the design says, the recommendation and why, and I accept, change or reject it. Some of my calls went against the AI's recommendation. It proposed building Prometheus alert rules; I kept them out, because the brief asks for an observability strategy, not alerting infrastructure, and rules that no real traffic can trigger are untested code. Separate database roles stay a documented follow-up, and the load test waits until the booking logic is verified.

### Reviewing the code

I cut the implementation into vertical slices, one endpoint per pull request in a few small commits, so that every change the agent made stayed small enough for me to read. I reviewed each one before merging it. A review catches what tests cannot, and mine regularly sent work back:

- a constant defined again in a second file instead of shared from the interval module;
- a framework decorator used where the project has its own;
- the response envelope my other projects use, which the agent had left out; that ended in a recorded decision, with its trade-offs, not to wrap responses here;
- comments and commit messages that cited internal planning documents a reader of this repository cannot open; they now say what changed and why.

Before accepting a choice I asked why. Each question ended in a recorded reason or a code change.

### Guardrails for the agent

- **[AGENTS.md](AGENTS.md) holds the hard rules**: every `ON CONFLICT` names its target, the four constraint names never change, no network calls inside the booking transaction, `src/domain` imports nothing from the framework or the database, and invariant tests are never weakened. Where tooling can check a rule, it does: ESLint enforces the domain boundary, CI fails when `openapi.yaml` drifts from the code, and coverage of `src/domain` must stay at 95 %.
- **The database contract came before the booking code.** The schema and the invariant tests (overlaps, back-to-back bookings, cancellation, `ON CONFLICT`, races) were merged before any booking endpoint existed, as the history shows. The agent's job was to satisfy that contract, not to define it.
- **Every slice had the same definition of done**: its e2e status-code table passes, `openapi.yaml` is regenerated, the README and `requests.http` cover the endpoint, and the whole suite is green.

### Verification: tests that prove something

- **A real database, never mocks.** Integration and e2e tests run on PostgreSQL 18.4 through Testcontainers, because a mock cannot prove an exclusion constraint. The e2e tests also validate responses against the committed `openapi.yaml`.
- **Property-based tests for the domain core.** One found a real bug: an empty interval `[83, 83)` counted as overlapping `[0, 84)` ([interval.spec.ts](test/unit/domain/interval.spec.ts)). Another checks that, with every technician and bay free, the booking rules accept a start exactly when the availability search offers it.
- **Mutation checks: break the guard, watch a test fail, restore it.** With retries switched off, the "3 technicians + 3 bays, 20 parallel requests → exactly 3 confirmed" test still passed, because later requests read a snapshot that already held the winners and never lost a race. The suite now holds the contested locks until every request is waiting ([booking-concurrency.e2e-spec.ts](test/e2e/booking-concurrency.e2e-spec.ts)), and without retries it fails on every run. Removing the status check from the cancel update makes four tests fail. The overlap reconciliation query is tested on a database whose constraints were dropped, so its empty result means something.
- **Concurrency tests assert outcomes that hold under every interleaving** (exact counts, zero overlaps), never timing. [scripts/race.sh](scripts/race.sh) repeats the race against the running stack.

### Decisions that changed behaviour while building

- **Retry after a lost race.** Dropping only the resource named in the error collides again on the winner's other resource, so a retry now re-reads availability. This was caught while planning, before any code.
- **Simultaneous inserts.** Measured on PostgreSQL 18.4, 20 bookings arriving at the same instant deadlocked in one round out of five and answered `503` instead of `409`. Advisory locks taken in key order now queue those writers; the constraints remain the guarantee.
- **Idempotency under a race.** Two requests with the same key can collide on the vehicle constraint instead of the key, so every `409` looks the key up again before refusing.
- **Error contract.** The extension that says why a cancel was refused would have been called `status`, which overwrites the HTTP status in problem details; it is `appointmentStatus`.

### How quality was ensured

- CI runs lint (including the domain boundary), the format check, the type-check, unit tests with the coverage gate, integration and e2e tests on PostgreSQL 18, the build, the `openapi.yaml` drift check and an image scan. The same sequence ran locally before each pull request.
- The observability was checked in the compose stack, not assumed: the span tree of a booking that lost a race, the business metrics in Prometheus, and decision logs that carry IDs but never a name or a VIN.
