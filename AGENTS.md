# AGENTS.md

Rules for anyone changing this repository, including AI coding agents.

## Hard rules

1. Every `ON CONFLICT` names its target, e.g. `ON CONFLICT (idempotency_key) DO NOTHING`. Without a target PostgreSQL also treats the exclusion constraints as arbiters and silently skips a double booking.
2. Never rename or drop `appointment_no_technician_overlap`, `appointment_no_bay_overlap`, `appointment_no_vehicle_overlap` or `technician_shift_no_overlap`. The service maps `23P01` errors by constraint name.
3. No network calls inside the booking transaction. Transactions stay short and set `lock_timeout`.
4. `src/domain` imports nothing from NestJS, Kysely, `pg` or other `src` folders. ESLint enforces this.
5. Invariant tests (overlap, back-to-back, cancellation, `ON CONFLICT` and concurrency tests) may not be weakened to make code pass.

## Conventions

- Migrations are hand-written, timestamp-prefixed SQL files. Never edit a migration that has been merged; add a new one.
- All SQL lives in repositories. Services orchestrate repositories and the domain core; they do not build queries.
- Controllers map results to response DTOs explicitly; services return plain data.
- Independent queries run with `Promise.all`; sequential `await` only when one result feeds the next.
- Errors are RFC 9457 `application/problem+json` with a stable `code`. Never leak raw database messages.
- Never log personal data (customer name, email, phone, VIN). Log IDs only.
- Comment only what the code cannot say itself: the reason, not the mechanics.

## Before you push

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e
```
