# MyPitWall backend

NestJS 12 + TypeScript API for F1 standings, results, race calendars, authentication, the admin portal, and live timing. Existing API URLs and JSON contracts are preserved. Nest manages routing, dependency injection, authentication guards, Swagger, and application shutdown; its HTTP adapter is `@nestjs/platform-express`.

## Setup

Use Node.js **22.12+** (Node 24 recommended) and npm.

```bash
npm ci
cp .env.example .env # only for a new setup; retain your existing .env
npm run dev
```

The default port is **8080**. Configuration is loaded from `.env` at startup:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to 8080 |
| `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_DATABASE` | PostgreSQL connection |
| `PG_PORT` | PostgreSQL port; defaults to 5432 |
| `JWT_SECRET` | Secret used to sign and verify existing seven-day JWTs |
| `GOOGLE_CLIENT_ID` | Google ID-token audience |
| `F1_LIVETIMING_TOKEN` | Optional F1 TV token when required by the live feed |

The existing hosted PostgreSQL SSL configuration is preserved. Existing database tables and raw SQL are retained; this framework migration does not require schema changes. The optional SQL setup files remain in `sql/`. Profile, account-deletion, and sprint services retain their existing lazy table/column initialization.

## Commands

```bash
npm run dev          # Nest development server with rebuilds
npm start            # build and start once
npm run build        # compile TypeScript into dist/
npm run start:prod   # run the compiled server
npm run typecheck    # strict TypeScript checking
npm test             # build and run all tests
npm run format:check # check source and test formatting
```

For production, build before installing only production dependencies (or use a separate build stage), then run `npm run start:prod`. The former `node server.js` entrypoint is replaced by `node dist/main.js`. `SIGINT`/`SIGTERM` close the database pool, SSE streams, WebSocket connection, replay/simulator timers, and pending live-feed fetches.

## API

- Health: `GET /health`; PostgreSQL check: `GET /db-test`.
- Documentation: `/api-docs`; OpenAPI JSON: `/api-docs-json`.
- Resources: `/drivers`, `/constructors`, `/results`, `/races`, `/trivia`.
- Authentication: `/auth/register`, `/auth/login`, `/auth/google`.
- Profiles: `GET`/`PUT /profile/:id`.
- Account deletion requests: `POST /account/delete-request`.
- Admin: `/admin/verify`, `/admin/tables`, and table-driven CRUD under `/admin/:table`.
- Live timing: `/live/state`, `/live/stream`, simulator, archive, and replay endpoints.
- Legacy alias: `GET /get-all-drivers`.

See [the complete route inventory](docs/api-routes.md) for all 44 method/path combinations. Admin endpoints retain their Bearer JWT guard and recheck `is_admin` in PostgreSQL on every request. Other routes retain their existing access rules. Error keys (`message` versus `error`) and success status codes remain compatible.

The SSE stream preserves `snapshot`, `update`, `status`, and `replay` events and 15-second keepalive comments. The upstream connection remains lazy, with a 60-second idle grace period. Simulation and archive replay share the same ingest path and are mutually exclusive with the live feed.

## Structure and verification

Each feature has a Nest module, controller, and injectable service under `src/<feature>/`. `DatabaseModule` supplies a shared pool; sync operations use a single checked-out connection per transaction. `src/main.ts` is the entrypoint and `src/app.setup.ts` configures CORS, JSON parsing, and Swagger.

The test suite includes 146 HTTP cases captured from the original Express app, plus route/documentation coverage, authentication, SQL/service behavior, transactions, feed merging, simulation, replay controls, and real local SSE connections and shutdown. Tests use database and external-provider doubles and do not modify a configured database or need a `.env` file. Running tests requires permission to open local loopback sockets. Live Google authentication and upstream-provider availability still depend on valid credentials and the external services.
