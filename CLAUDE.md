# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Express backend ("pitwall-backend") that syncs F1 data (drivers, constructors, race results, qualifying) from the Ergast-compatible Jolpica API (`https://api.jolpi.ca/ergast/f1/...`) into PostgreSQL, and serves it to the MyPitWall dashboard frontend. Also provides JWT/Google OAuth user authentication.

## Commands

```bash
npm run dev      # start with nodemon (auto-reload) — used for local development
npm start         # same as dev (also nodemon), used in production per package.json
```

There is no test suite configured (`npm test` is a stub that exits 1) and no lint script. Don't assume either exists.

Server reads config from `.env` (gitignored): `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_DATABASE`, `PG_PORT`, `PG_SCHEMA`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`. The Postgres connection always sets `ssl: { rejectUnauthorized: false }` (`src/config/database.js`), which assumes a hosted Postgres (e.g. Supabase/RDS).

API docs are auto-generated from JSDoc `@swagger` comments in route files and served at `/api-docs` (see `src/config/swagger.js`).

## Architecture

Layered MVC-ish structure under `src/api/`:

- `routes/*.js` — Express routers; only wire paths to controller methods and hold the `@swagger` JSDoc used to build the OpenAPI spec. `routes/index.js` mounts `/health` and `/db-test` directly, plus `/constructors`, `/drivers`, `/results`, `/auth` sub-routers.
- `controllers/*.js` — thin HTTP adapters: pull params/body from `req`, call the matching service, catch errors and map to a JSON error response. No business logic or SQL here.
- `services/*.js` — all business logic, SQL queries (via `src/config/database.js`'s `db.query`), and calls to the external Jolpica/Ergast API live here.
- `middlewares/authMiddleware.js` — verifies `Authorization: Bearer <JWT>` using `JWT_SECRET` and attaches the decoded payload to `req.user`. Not yet applied to any routes in `routes/index.js`/sub-routers — apply it explicitly per-route if protecting an endpoint.

This pattern (route → controller → service → db) is consistent across drivers/constructors/results/auth; follow it for new resources rather than introducing a different layering.

### Sync vs. read pattern

Result/qualifying/driver/constructor data follows a two-phase pattern seen in `resultService.js`:
1. A `sync*` function pages through the external Ergast API (`limit`/`offset`, checking `MRData.total`), upserts rows with `INSERT ... ON CONFLICT (id) DO UPDATE`, wrapped in a single `BEGIN`/`COMMIT`/`ROLLBACK` transaction over the whole paged sync.
2. A `get*FromDb` function reads back from local Postgres only (joining `results`/`qualifying` against `drivers` and `constructors` for display fields), never hitting the external API on the read path.

IDs for synced rows are constructed as `${season}_${round}_${driverId}` to dedupe upserts across re-syncs.

### Auth

`authService.js` supports email/password (bcrypt-hashed, stored in a `users` table) and Google OAuth (`google-auth-library` verifies the ID token, then upserts into `users` keyed by email). Both paths issue the same JWT (7d expiry, signed with `JWT_SECRET`) via `generateToken`.

### Database

No migration tool/ORM — tables (`drivers`, `drivers_season`, `constructors`, `constructors_season`, `results`, `qualifying`, `users`) are assumed to pre-exist in Postgres; schema changes must be made manually against the DB. Queries are raw SQL via the `pg` `Pool` exposed from `src/config/database.js`.
