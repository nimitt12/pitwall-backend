# MyPitWall backend

NestJS 12 + TypeScript API for F1 standings, results, race calendars, authentication, the admin portal, and live timing. Existing API URLs are preserved; security hardening adds authorization and strict input requirements. Nest manages routing, dependency injection, authentication guards, Swagger, and application shutdown; its HTTP adapter is `@nestjs/platform-express`.

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
| `JWT_SECRET` | Random signing secret; production requires at least 32 characters |
| `JWT_TTL_SECONDS` | New token lifetime; defaults to one hour |
| `GOOGLE_CLIENT_ID` | Google ID-token audience |
| `CORS_ORIGINS` | Exact browser origins; HTTPS required in production |
| `REDIS_ENABLED` | Enables shared Redis rate-limit storage; defaults to `false` |
| `REDIS_URL` | Redis connection URL; required when `REDIS_ENABLED=true` |
| `TRUST_PROXY` | Actual proxy IPs/CIDRs; unset for direct access |
| `PG_POOL_MAX` | Per-instance database connections; defaults to 10 |
| `PG_SSL_CA`, `PG_SSL_CA_FILE` | Optional provider CA override for verified TLS |
| `F1_LIVETIMING_TOKEN` | Optional F1 TV token when required by the live feed |

PostgreSQL now verifies TLS certificates and hostnames. Supabase's official public CA is bundled for Supabase hosts; other providers can supply a CA override. Apply the relevant files in `sql/` before production startup: production request handlers do not create or alter tables. Use a restricted application database role and a separate migration role. See [security and deployment guidance](docs/security.md) for required configuration, limits, and scaling constraints.

## Commands

```bash
npm run dev          # Nest development server with rebuilds
npm start            # build and start once
npm run build        # compile TypeScript into dist/
npm run start:prod   # run the compiled server
npm run typecheck    # strict TypeScript checking
npm test             # build and run all tests
npm run format:check # check source and test formatting
npm run security:check # dependency audit, typecheck and tests
npm run test:redis   # Redis integration test; needs redis-server or REDIS_SERVER_BIN
```

For production, build before installing only production dependencies (or use a separate build stage), then run `npm run start:prod`. This sets `NODE_ENV=production` and refuses unsafe secret, CORS, TLS, or enabled Redis configuration. The former `node server.js` entrypoint is replaced by `node dist/main.js`. `SIGINT`/`SIGTERM` close the database pool, SSE streams, WebSocket connection, replay/simulator timers, and pending live-feed fetches.

## API

- Health: `GET /health`; PostgreSQL check: `GET /db-test` (admin).
- Development documentation: `/api-docs`; OpenAPI JSON: `/api-docs-json`. Both are disabled in production.
- Resources: `/drivers`, `/constructors`, `/results`, `/races`, `/trivia`.
- Authentication: `/auth/register`, `/auth/login`, `/auth/google`.
- Profiles: `GET`/`PUT /profile/:id`.
- Account deletion requests: `POST /account/delete-request`.
- Admin: `/admin/verify`, `/admin/tables`, and table-driven CRUD under `/admin/:table`.
- Live timing: `/live/state`, `/live/stream`, simulator, archive, and replay endpoints.
- Legacy alias: `GET /get-all-drivers`.

See [the complete route inventory](docs/api-routes.md) for all 44 method/path combinations. Admin endpoints retain their Bearer JWT guard and recheck `is_admin` in PostgreSQL on every request. Profiles and deletion requests now require the owning user’s bearer token. Sync and live-control actions require admin access. Public reads are rate limited. Success status codes remain compatible; strict validation and sanitized errors are intentional security changes.

The SSE stream preserves `snapshot`, `update`, `status`, and `replay` events and 15-second keepalive comments. The upstream connection remains lazy, with a 60-second idle grace period. Simulation and archive replay share the same ingest path and are mutually exclusive with the live feed.

## Structure and verification

Each feature has a Nest module, controller, and injectable service under `src/<feature>/`. `DatabaseModule` supplies a shared pool; sync operations use a single checked-out connection per transaction. `src/main.ts` is the entrypoint and `src/app.setup.ts` configures CORS, JSON parsing, and Swagger.

The test suite includes 146 HTTP cases captured from the original Express app, adapted for intentional security changes, plus adversarial security tests, distributed Redis coverage, route/documentation coverage, authentication, SQL/service behavior, transactions, feed merging, simulation, replay controls, and real local SSE connections and shutdown. Tests use database and external-provider doubles and do not modify a configured database or need a `.env` file. Running tests requires permission to open local loopback sockets. Live Google authentication and upstream-provider availability still depend on valid credentials and the external services.

Live state is process-local: route all `/live/*` requests to one dedicated instance. Ordinary API replicas share PostgreSQL and can share rate limits through optional Redis; see the security guide before scaling sync jobs or live timing.
