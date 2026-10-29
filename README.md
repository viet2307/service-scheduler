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
