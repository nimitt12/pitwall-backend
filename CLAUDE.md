# Repository guidance

## Project

MyPitWall's NestJS 12 / TypeScript backend. It syncs F1 data from Jolpica and OpenF1 into PostgreSQL and serves the dashboard, admin portal, authentication, live timing, simulation, and archive replay. See README.md for setup and docs/api-routes.md for the complete API inventory.

## Commands

- `npm run dev`: Nest watch mode.
- `npm start`: compile and start once.
- `npm run build`: compile to `dist/`.
- `npm run start:prod`: run `dist/main.js`.
- `npm run typecheck`: strict TypeScript checking.
- `npm test`: build and run the Node test suite.
- `npm run format:check`: check Prettier formatting.

Node 22.12+ is required; Node 24 is recommended. This is an ESM project; relative TypeScript imports use `.js` extensions. No plain Express entrypoint or router files remain.

## Architecture

- `src/main.ts` loads `.env`, creates the Nest app, configures shutdown hooks, and listens on `PORT` (default 8080).
- `src/app.module.ts` composes the feature modules.
- `src/app.setup.ts` configures CORS, JSON parsing, request logging, and Swagger at `/api-docs` (`/api-docs-json`).
- Each `src/<feature>/` directory contains a module, controller, and injectable service. Controllers own HTTP contracts; services own business logic and SQL.
- `DatabaseModule` provides `DatabaseService` globally. Use `db.query` for standalone queries and `db.transaction(async client => ...)` for transactions. Never run `BEGIN` and transactional queries through independent pool queries.
- `AuthModule` exports `AuthGuard` and `AdminAuthGuard`. Admin routes use the latter, which verifies JWTs and checks the current database `is_admin` flag. Preserve existing public-route behavior unless authorization changes are requested explicitly.
- Nest Swagger decorators document the actual controller routes. Keep request schemas and response codes in sync with behavior.

## Compatibility

Preserve the existing route URLs, status codes, JSON shapes, and error keys. No global prefix or response envelope is applied. POST actions such as login, simulation, and replay return 200; registration, admin creation, and account-deletion requests return 201. JWTs retain their existing claims, secret, and seven-day lifetime. Raw SQL and the existing hosted PostgreSQL SSL settings are retained.

`test/fixtures/express-contracts.json` was captured from the original Express app using deterministic service doubles. `test/api-contracts.test.cjs` verifies responses and service arguments against it. Service, transaction, replay, and SSE tests cover the real implementations with isolated external dependencies. Tests must not require credentials or mutate a live database.

## Live timing

`src/live/live-timing.service.ts` owns the SignalR Core connection, state, emitter, timers, and archive cache per Nest instance. The upstream opens on the first SSE subscriber and closes 60 seconds after the last subscriber leaves. Compressed `.z` topics are inflated; other deltas are deep-merged, including numeric array patches.

Live, simulation, and replay sources are mutually exclusive. Replay downloads F1 static `.jsonStream` archives, supports pause/resume/speed/seek, and broadcasts full snapshots on reset. `onModuleDestroy` aborts pending fetches, closes subscribers, and releases sockets and timers. Preserve that lifecycle when adding background work.
