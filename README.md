# Unified Service Scheduler

Backend for booking vehicle service appointments at a dealership. A booking is confirmed only when **one qualified technician and one compatible service bay are both free for the whole service duration**, and PostgreSQL exclusion constraints guarantee that no technician, bay or vehicle is ever double-booked.

## Stack

| Concern       | Choice                                  |
| ------------- | --------------------------------------- |
| Runtime       | Node.js 24 LTS, TypeScript (strict)     |
| Framework     | NestJS 11 (Express adapter)             |
| Database      | PostgreSQL 18, Kysely, hand-written SQL |
| Observability | OpenTelemetry, Pino                     |
| Tests         | Jest, supertest, Testcontainers         |

## Getting started

Prerequisites: Node.js 24 (`nvm use`) and npm 11.

```bash
npm ci
cp .env.example .env
npm run start:dev
curl localhost:3000/health/live
```

## Scripts

| Script                 | Purpose                              |
| ---------------------- | ------------------------------------ |
| `npm run start:dev`    | Run the API in watch mode            |
| `npm run build`        | Compile to `dist/`                   |
| `npm run start:prod`   | Run the compiled API                 |
| `npm run lint`         | ESLint (type-aware)                  |
| `npm run format:check` | Prettier check                       |
| `npm run typecheck`    | `tsc --noEmit` over `src` and `test` |
| `npm test`             | Unit tests                           |
| `npm run test:e2e`     | HTTP tests through the Nest app      |

## Docker

```bash
docker compose up --build
```

| Service          | URL                    | Purpose                                    |
| ---------------- | ---------------------- | ------------------------------------------ |
| `api`            | http://localhost:3000  | The scheduler API                          |
| `postgres`       | localhost:5432         | PostgreSQL 18.4 (`scheduler`/`scheduler`)  |
| `otel-collector` | localhost:4317 / 4318  | OTLP gRPC / HTTP receiver                  |
| `jaeger`         | http://localhost:16686 | Traces                                     |
| `prometheus`     | http://localhost:9090  | Metrics (pushed by the collector via OTLP) |

The image is multi-stage, runs as the unprivileged `node` user, ships only production dependencies and has a `HEALTHCHECK` on `/health/live`.

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main` and `v*.*.*` tags:

1. **verify**: lint, format check, type-check, unit tests with coverage, e2e tests, build.
2. **image**: build the Docker image, smoke-test `/health/live`, scan it with Trivy (fails on fixable HIGH/CRITICAL). On `main` and tags it is pushed to `ghcr.io/<owner>/<repo>` with SBOM and provenance attestations.
3. **deploy**: rolls the new image digest out to an ECS service and waits for it to stabilise. It runs on `main` only, and only when the repository variables below are set, so it stays inert until AWS is wired up.

| Repository variable   | Example                                     |
| --------------------- | ------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/gha-deploy` |
| `AWS_REGION`          | `ap-southeast-1`                            |
| `ECS_CLUSTER`         | `service-scheduler`                         |
| `ECS_SERVICE`         | `service-scheduler-api`                     |
| `ECS_TASK_FAMILY`     | `service-scheduler-api`                     |

The deploy role is assumed through GitHub OIDC (no long-lived keys). The task definition's container must be named `api` and needs registry credentials to pull from GHCR. Actions are pinned to commit SHAs and kept current by Dependabot.

## Project layout

```
src/
  main.ts            bootstrap
  app.module.ts      root module
  health/            liveness endpoint
  domain/            pure business rules (no framework imports; enforced by ESLint)
test/
  unit/              no I/O
  e2e/               HTTP through the Nest app (supertest)
```

See [AGENTS.md](AGENTS.md) for the rules every change (human or AI-generated) must follow.
