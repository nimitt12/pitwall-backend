# Security review and deployment

This review hardens all 44 existing API routes. It covers application code, dependencies, authorization, runtime input validation, database transport, request abuse, live streaming, and resource limits. It is not an independent penetration test or proof against every attack. No production schema changes or credential rotations were performed.

## Findings addressed

| Finding | Change |
| --- | --- |
| Anonymous profile reads/edits and forged account-deletion requests | Bearer JWT, current database user lookup, and strict ownership checks |
| Public database sync, simulation and replay controls | Current database admin privilege required; database diagnostics protected too |
| Password hashes returned on signup/login/Google login | Explicit allowlist of public user fields |
| Permissive JWT verification and long sessions | HS256 only, mandatory expiry and valid user ID; new tokens expire in one hour (configurable 60–86400 seconds) |
| Google email/account linking assumptions | Require verified email and configured audience; never silently link password accounts or mismatched Google subjects by email |
| Missing abuse protection | Aggregate client rate limits, shared Redis counters, global auth budget, concurrency caps |
| No runtime body/parameter constraints | Strict auth/profile/account/replay schemas, identifier and year/round bounds, query duplication rejection, nesting and body limits |
| Inherited properties accepted by SQL allowlists | Own-property checks on tables/columns; hidden columns forbidden as filters |
| Database errors and request queries exposed | Generic 5xx bodies; request logs contain route templates, method and status, not tokens, query strings or bodies |
| Wildcard CORS and missing browser protections | Exact origin allowlist, Helmet headers, no-store responses, production HSTS |
| PostgreSQL TLS verification disabled | Verify chain and hostname; provider CA support and Supabase public CA bundled |
| Unbounded external work and memory | Outbound deadlines/size caps, bounded lap cache and coalesced fetches, serialized sync jobs, SSE limits and slow-consumer disconnects |
| Feed parser attack surface | Decompression bound, permitted topics, recursion/index limits, dangerous merge keys ignored |

SQL values remain parameterized. Admin SQL identifiers remain server-owned allowlists. Passwords use bcrypt; signup requires at least 12 characters and passwords cannot exceed bcrypt's 72-byte limit. Authentication failures use generic responses. User IDs use cryptographic UUIDs. The frontend must treat all stored strings as untrusted and render them safely.

## Intentional client changes

- `/profile/:id` GET and PUT and `/account/delete-request` require the owner's `Authorization: Bearer <token>`.
- All `/.../sync-*`, `/live/simulate/*`, `/live/replay/*`, and `/db-test` require a current admin. Public live state, SSE, archive indexes, and F1 reads remain public.
- Unknown fields in auth/profile/account/replay bodies return 400. Send only documented properties. Invalid types, repeated query values, unsupported content types and oversized bodies are rejected.
- Signup passwords need 12+ characters. Successful user objects never include password hashes or unrelated internal columns. 5xx bodies are `{ "message": "Internal server error" }` (503 has a temporary-unavailable message).
- Swagger UI and JSON are disabled in production. Existing HTTP paths and successful status codes remain intact.
- Google login cannot implicitly link an existing password account; users must continue using password login until an explicitly authenticated linking flow is implemented.
- Existing HS256 tokens with a valid ID and expiry remain valid until expiry unless the signing secret is rotated. New tokens default to one hour. Deleted users lose access immediately; admin rights are rechecked on every protected admin request. There is no refresh-token system or per-token logout/revocation store.

## Production configuration

`npm run start:prod` explicitly sets `NODE_ENV=production`. Startup requires a non-placeholder JWT secret of at least 32 characters and exact HTTP or HTTPS `CORS_ORIGINS`. Redis is optional and disabled by default. Set `REDIS_ENABLED=true` and provide `REDIS_URL` to share rate-limit counters across instances. When enabled, Redis must be reachable at startup; unavailable rate-limit storage returns 503, never unrestricted traffic. The client reconnects after runtime outages and bounds command queues/timeouts. Do not expose Redis publicly; use authentication, private networking and TLS where supported.

Generate a new JWT secret with `openssl rand -hex 32`. Rotate any database password or JWT secret exposed in logs, chat, or source control. JWT secret rotation invalidates all existing sessions. `.env` is ignored and was not changed by this review.

Terminate HTTPS at a trusted reverse proxy/load balancer. The application HTTP listener must only be reachable through that proxy. Set `TRUST_PROXY` to its actual IPs/CIDRs; forwarded client addresses are otherwise ignored. Do not trust arbitrary proxies or all-network CIDRs. Configure request/header limits, connection limits and slow-client timeouts at the edge too. Browser CORS is not an authorization mechanism.

Set `CORS_ORIGINS` to exact frontend origins without paths or trailing slashes. Development defaults allow localhost ports 3000 and 5173. Native/nonbrowser clients still require the same authorization and rate limits.

PostgreSQL verifies both certificate chain and hostname. `PG_SSL_CA` (PEM text) or `PG_SSL_CA_FILE` overrides the trust anchor. Supabase hostnames automatically use the public CA published by the official Supabase dashboard; other hosts use Node's default roots. The bundled CA expires April 26, 2031; update it when the provider rotates certificates. Never disable certificate verification to work around a certificate error. `PG_SSL=false` is accepted only outside production for local databases.

Use a dedicated application database role with only the required SELECT/INSERT/UPDATE/DELETE permissions, not a database owner. Apply the relevant SQL files in `sql/` with a migration role before production startup, including `profile_preferences.sql`, `account_deletion_requests.sql` and `sprint.sql`. Production request handlers no longer run lazy DDL. Existing base users/drivers/constructors/results tables are still prerequisites. Inspect indexes for actual queries and data volumes before adding replicas; indexes and migrations were not applied to the live database.

## Limits and scaling

| Control | Default | Configuration |
| --- | --- | --- |
| All HTTP requests, including errors and unknown paths | 120 per client per minute | `RATE_LIMIT_PUBLIC` |
| Login/register/Google combined | 10 per client per 15 minutes | `RATE_LIMIT_AUTH` |
| Auth service-wide budget | 100 per minute | `RATE_LIMIT_AUTH_GLOBAL` |
| Sync, live controls/archive, constructor upstream reads, lap fetches, deletion requests | 10 per client per minute combined | `RATE_LIMIT_EXPENSIVE` |
| Active non-SSE HTTP requests per instance | 200 | `HTTP_MAX_INFLIGHT` |
| Active SSE connections per instance / client | 200 / 3 | `SSE_MAX_CONNECTIONS` / `SSE_MAX_PER_IP` |
| Active expensive HTTP requests per instance | 4 | Code constant |
| Sync / replay-load operations per instance | One of each group | Shared Nest work gate |
| PostgreSQL connections per instance | 10; 100 queued requests maximum | `PG_POOL_MAX` |
| Database acquisition / statement / client query timeout | 5 / 15 / 20 seconds | Code constants |
| HTTP headers / incoming request / idle keepalive | 10 / 30 / 5 seconds | Code constants; SSE remains long-lived |
| JSON body | 32 KiB | Code constant |
| Axios upstream deadline / decoded response / concurrency | 10 seconds / 8 MiB / 16 | Code constants |
| Live/archive fetch deadline / decoded response | 15 seconds / 8 MiB per topic | Code constants |
| Inflated feed payload | 8 MiB | Code constant |
| Lap cache / concurrent distinct lap fetches | 50 races / 4 | Code constants |
| SSE queued-output threshold | 256 KiB; lagging clients disconnected | Code constant |

Limits count IPv6 subnets, preventing trivial per-address rotation. Rate-limited responses include `Retry-After` and standard `RateLimit` headers. Aggregate limits can affect users sharing NAT; tune them with measured traffic and keep edge protection in place. With `REDIS_ENABLED=false`, counters are stored in each process and reset on restart. This is suitable for a single instance, but replicas do not share a global budget. Multi-instance deployments should enable Redis on every replica with the same deployment and consistent settings. Configure Redis memory limits/monitoring so counters are not silently evicted under normal traffic.

Stateless API routes can run across replicas with shared PostgreSQL. Total pool usage is `replicas × PG_POOL_MAX`; leave capacity for migrations, administration and provider limits. Local concurrency and in-memory rate limits multiply by replica count. When Redis is enabled, authentication's global budget and client counters remain shared.

Live timing, simulation and replay state remain in process memory. Route **all `/live/*` traffic to one dedicated instance** to preserve one shared session. Sticky sessions alone do not synchronize separate instances. Route admin synchronization jobs to one instance too; their concurrency gate is per process. For larger deployments, move synchronization to a durable worker queue and distribute live snapshots/events with a shared event bus before scaling those features horizontally. This review does not claim to have implemented that architecture or load-tested a target throughput.

Use edge/CDN DDoS protection, monitoring for 429/503 rates and database latency, provider connection alerts, secret rotation, and tested backups. App rate limiting cannot absorb network-level floods. Public F1 datasets still return their existing response shapes; large historical data growth should trigger paginated API contracts and measured query/index work.

## Verification

- `npm test`: API contracts plus adversarial authorization, input, rate-limit, streaming, database/service and lifecycle tests, using isolated doubles and local HTTP listeners.
- `npm run test:redis`: starts an ephemeral local Redis process (`redis-server` on PATH or `REDIS_SERVER_BIN`), verifies two production instances share budgets, counters survive app restart, production docs are hidden, and Redis loss fails closed.
- `npm run security:check`: dependency advisory audit, typecheck, and test suite.
- `npm run format:check`: formatting.

The review also checked the configured database using read-only SELECT over verified TLS. Live Google authentication and F1 subscriptions were not exercised; their credential/provider behavior is mocked in tests. No load test, external penetration test, or live database writes were performed.

References: [OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [Nest rate limiting](https://docs.nestjs.com/security/rate-limiting), [Supabase verified TLS](https://supabase.com/docs/guides/platform/ssl-enforcement), [Supabase dashboard certificate source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).
