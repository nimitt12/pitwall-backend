const { it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const http = require('node:http');
const zlib = require('node:zlib');
const { createApp, services } = require('./helpers.cjs');
const { validateSecurityConfig } = require('../dist/security/config.js');
const { DatabaseService } = require('../dist/database/database.service.js');
const { RateLimitService } = require('../dist/security/rate-limit.service.js');
const { readBoundedText } = require('../dist/security/upstream.js');

function env(t, changes) {
  const previous = { ...process.env };
  Object.assign(process.env, changes);
  for (const [key, value] of Object.entries(changes))
    if (value === undefined) delete process.env[key];
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
}
function token(id = 'owner', options = {}) {
  return 'Bearer ' + jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: 3600, ...options });
}
async function setup(t, overrides = {}, db) {
  const calls = [];
  const base = {
    profileService: {
      getProfile: async (id) => {
        calls.push(id);
        return { id };
      },
      updateProfile: async (id, body) => {
        calls.push(id);
        return { id, ...body };
      },
    },
    accountService: {
      createDeletionRequest: async (id) => {
        calls.push(id);
        return { id };
      },
    },
    authService: {
      login: async () => ({ ok: true }),
      register: async () => ({ ok: true }),
      googleLogin: async () => ({ ok: true }),
    },
  };
  const result = await createApp(
    db || {
      query: async (_sql, args) => ({
        rows:
          args?.[0] === 'deleted'
            ? []
            : [
                {
                  id: args?.[0] || 'owner',
                  email: 'owner@example.com',
                  is_admin: args?.[0] === 'admin',
                },
              ],
      }),
    },
    { ...base, ...overrides },
  );
  t.after(() => result.app.close());
  return { ...result, calls, http: result.app.getHttpServer() };
}

const adminRoutes = [
  ['get', '/constructors/sync-constructor-season'],
  ['get', '/drivers/sync-driver-season'],
  ['get', '/results/sync-results'],
  ['get', '/results/sync-qualifying'],
  ['get', '/results/sync-sprint-results'],
  ['get', '/results/sync-sprint-qualifying'],
  ['get', '/db-test'],
  ['post', '/live/simulate/start'],
  ['post', '/live/simulate/stop'],
  ['post', '/live/replay/start'],
  ['post', '/live/replay/pause'],
];
for (const [method, path] of adminRoutes) {
  it(`protects ${method.toUpperCase()} ${path} from anonymous and ordinary users`, async (t) => {
    const { http } = await setup(t);
    await request(http)[method](path).expect(401);
    await request(http)[method](path).set('Authorization', token()).expect(403);
  });
}
for (const method of ['get', 'put']) {
  it(`enforces ownership on profile ${method}`, async (t) => {
    const { http, calls } = await setup(t);
    await request(http)[method]('/profile/owner').expect(401);
    await request(http)
      [method]('/profile/victim')
      .set('Authorization', token())
      .send(method === 'put' ? {} : undefined)
      .expect(403);
    await request(http)
      [method]('/profile/deleted')
      .set('Authorization', token('deleted'))
      .expect(401);
    assert.deepEqual(calls, []);
    await request(http)
      [method]('/profile/owner')
      .set('Authorization', token())
      .send(method === 'put' ? { fav_drivers: ['norris'] } : undefined)
      .expect(200);
    assert.deepEqual(calls, ['owner']);
  });
}
it('requires ownership for account-deletion requests', async (t) => {
  const { http, calls } = await setup(t);
  const body = { userId: 'victim', email: 'victim@example.com' };
  await request(http).post('/account/delete-request').send(body).expect(401);
  await request(http)
    .post('/account/delete-request')
    .set('Authorization', token())
    .send(body)
    .expect(403);
  assert.deepEqual(calls, []);
  await request(http)
    .post('/account/delete-request')
    .set('Authorization', token())
    .send({ userId: 'owner', email: 'owner@example.com' })
    .expect(201);
});
for (const claims of [{ id: 'owner' }, { id: {} }, { id: '../owner' }]) {
  it(`rejects missing expiry or malformed JWT claims ${JSON.stringify(claims)}`, async (t) => {
    const { http } = await setup(t);
    await request(http)
      .get('/profile/owner')
      .set('Authorization', 'Bearer ' + jwt.sign(claims, process.env.JWT_SECRET))
      .expect(401);
  });
}
it('rejects alternate signing algorithms and expired tokens', async (t) => {
  const { http } = await setup(t);
  await request(http)
    .get('/profile/owner')
    .set('Authorization', token('owner', { algorithm: 'HS384' }))
    .expect(401);
  await request(http)
    .get('/admin/verify')
    .set('Authorization', token('admin', { expiresIn: -1 }))
    .expect(401);
});

for (const body of [
  { email: ['a@example.com'], password: 'long-password' },
  { email: 'not-an-email', password: 'long-password' },
  { email: 'a@example.com', password: 'short' },
  { email: 'a@example.com', password: 'ü'.repeat(37) },
  { email: 'a@example.com', password: 'long-password', is_admin: true },
  { email: 'a@example.com', password: 'long-password', fullName: { malicious: true } },
]) {
  it(`rejects unsafe registration input ${JSON.stringify(body)}`, async (t) => {
    let called = false;
    const { http } = await setup(t, {
      authService: {
        register() {
          called = true;
        },
      },
    });
    await request(http).post('/auth/register').send(body).expect(400);
    assert.equal(called, false);
  });
}
it('rejects profile mass assignment and excessive favorites', async (t) => {
  const { http, calls } = await setup(t);
  for (const body of [
    { is_admin: true },
    { fav_drivers: ['a', 'b', 'c'] },
    { fav_constructor: {} },
  ]) {
    await request(http).put('/profile/owner').set('Authorization', token()).send(body).expect(400);
  }
  assert.deepEqual(calls, []);
});
for (const path of [
  '/races?season=2026&season=2025',
  '/races?season=2026%2F..%2F',
  '/results/get-lap-positions/2026/99',
  '/results/get-lap-positions/2026%3Ffoo/1',
  '/admin/users?limit=100000',
  '/admin/users?page=Infinity',
]) {
  it(`rejects invalid parameters ${path}`, async (t) => {
    const { http } = await setup(t);
    await request(http).get(path).set('Authorization', token('admin')).expect(400);
  });
}
for (const path of [
  'https://evil.test/',
  '2026/../../',
  '2026/meeting/race/?redirect=evil',
  '2026/meeting/%2e%2e/',
]) {
  it(`rejects unsafe replay paths ${path}`, async (t) => {
    const { http } = await setup(t);
    await request(http)
      .post('/live/replay/start')
      .set('Authorization', token('admin'))
      .send({ path })
      .expect(400);
  });
}
it('hides database and upstream details from HTTP failures', async (t) => {
  const { http } = await setup(t, {
    profileService: {
      getProfile() {
        throw new Error('password=super-secret SQL SELECT * stack');
      },
    },
  });
  const response = await request(http)
    .get('/profile/owner')
    .set('Authorization', token())
    .expect(500);
  assert.deepEqual(response.body, { message: 'Internal server error' });
});
it('sets security and no-store headers without advertising Express', async (t) => {
  const { http } = await setup(t);
  const res = await request(http).get('/health').expect(200);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['cache-control'], 'no-store');
});
it('permits only configured browser origins', async (t) => {
  env(t, { CORS_ORIGINS: 'https://pitwall.example' });
  const { http } = await setup(t);
  const allowed = await request(http).get('/health').set('Origin', 'https://pitwall.example');
  const denied = await request(http).get('/health').set('Origin', 'https://evil.example');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://pitwall.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
it('rejects unsupported content types and bodies larger than 32 KB', async (t) => {
  const { http } = await setup(t);
  await request(http).post('/auth/login').type('form').send('email=a&password=b').expect(415);
  await request(http)
    .post('/auth/login')
    .send({ password: 'x'.repeat(33 * 1024) })
    .expect(413);
});
it('rate limits public routes together and prevents spoofed X-Forwarded-For bypass', async (t) => {
  env(t, { RATE_LIMIT_PUBLIC: '2', TRUST_PROXY: undefined });
  const { http } = await setup(t);
  await request(http).get('/health').expect(200);
  await request(http).get('/live/state').expect(200);
  const res = await request(http).get('/health').set('X-Forwarded-For', '203.0.113.22').expect(429);
  assert.ok(res.headers['retry-after']);
  assert.ok(res.headers.ratelimit);
});
it('shares the stricter authentication budget across login/register/google routes', async (t) => {
  env(t, { RATE_LIMIT_AUTH: '2' });
  const { http } = await setup(t);
  await request(http)
    .post('/auth/login')
    .send({ email: 'a@example.com', password: 'password' })
    .expect(200);
  await request(http).post('/auth/google').send({ idToken: 'token' }).expect(200);
  await request(http)
    .post('/auth/register')
    .send({ email: 'a@example.com', password: 'long-password' })
    .expect(429);
  await request(http).get('/health').expect(200);
});
it('enforces a global authentication budget across distinct trusted client IPs', async (t) => {
  env(t, { RATE_LIMIT_AUTH_GLOBAL: '2', TRUST_PROXY: 'loopback' });
  const { http } = await setup(t);
  for (let i = 1; i <= 3; i++) {
    await request(http)
      .post('/auth/login')
      .set('X-Forwarded-For', `203.0.113.${i}`)
      .send({ email: 'a@example.com', password: 'password' })
      .expect(i <= 2 ? 200 : 429);
  }
});
it('groups IPv6 addresses within a subnet to prevent address-rotation bypass', async (t) => {
  env(t, { RATE_LIMIT_PUBLIC: '1', TRUST_PROXY: 'loopback' });
  const { http } = await setup(t);
  await request(http).get('/health').set('X-Forwarded-For', '2001:db8:abcd:1200::1').expect(200);
  await request(http).get('/health').set('X-Forwarded-For', '2001:db8:abcd:1200::2').expect(429);
});
it('enforces and releases simultaneous SSE connection limits', { timeout: 10000 }, async (t) => {
  env(t, { SSE_MAX_PER_IP: '1' });
  const { app, http: server } = await setup(t);
  app.get(services.liveTimingService).startSimulation();
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const open = () =>
    new Promise((resolve, reject) => {
      const req = http.get(url + '/live/stream', (res) => {
        res.resume();
        resolve({ req, res });
      });
      req.on('error', reject);
    });
  const first = await open();
  t.after(() => first.req.destroy());
  await request(server).get('/live/stream').expect(503);
  first.req.destroy();
  for (let i = 0; i < 100 && app.get(services.liveTimingService).getState().subscribers; i++)
    await new Promise((r) => setTimeout(r, 5));
  const next = await open();
  assert.equal(next.res.statusCode, 200);
  next.req.destroy();
});
it('protects inherited SQL identifiers and prevents filtering password hashes', async () => {
  const admin = new services.adminService({
    query: () => {
      throw new Error('must not query');
    },
  });
  for (const key of ['__proto__', 'constructor', 'toString'])
    assert.throws(
      () => admin.getConfig(key),
      (e) => e.status === 400,
    );
  for (const key of ['__proto__', 'constructor', 'password']) {
    await assert.rejects(admin.list('users', { filters: { [key]: 'x' } }), (e) => e.status === 400);
    await assert.rejects(admin.distinct('users', key), (e) => e.status === 400);
  }
});
it('bounds decompression and rejects prototype pollution in feed deltas', () => {
  const live = new services.liveTimingService();
  const merged = live.deepMerge(
    {},
    JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"safe":1}',
    ),
  );
  assert.equal({}.polluted, undefined);
  assert.deepEqual(merged, { safe: 1 });
  assert.deepEqual(live.deepMerge([], { 999999999: 'attack', '-1': 'attack' }), []);
  const compressed = zlib.deflateRawSync(Buffer.alloc(9 * 1024 * 1024, 'x')).toString('base64');
  assert.throws(() => live.inflate(compressed));
  live.onModuleDestroy();
});
it('bounds upstream bodies even when Content-Length is absent or forged', async () => {
  await assert.rejects(readBoundedText(new Response('abcdef'), 5), /size limit/);
  await assert.rejects(
    readBoundedText(new Response('a', { headers: { 'content-length': '99999' } }), 5),
    /size limit/,
  );
  assert.equal(await readBoundedText(new Response('abc'), 5), 'abc');
});
it('uses verified database TLS, pool limits and query deadlines', async (t) => {
  env(t, { PG_SSL: undefined });
  const db = new DatabaseService();
  t.after(() => db.onApplicationShutdown());
  assert.equal(db.pool.options.ssl.rejectUnauthorized, true);
  assert.equal(db.pool.options.max, 10);
  assert.equal(db.pool.options.statement_timeout, 15000);
  assert.equal(db.pool.options.connectionTimeoutMillis, 5000);
});
it('fails closed on unsafe production configuration', (t) => {
  env(t, {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    CORS_ORIGINS: 'https://pitwall.example',
    REDIS_ENABLED: 'true',
    REDIS_URL: 'redis://127.0.0.1:6379',
    PG_SSL: undefined,
    TRUST_PROXY: undefined,
  });
  assert.equal(validateSecurityConfig().production, true);
  for (const [key, value] of [
    ['JWT_SECRET', 'weak'],
    ['CORS_ORIGINS', '*'],
    ['REDIS_URL', ''],
    ['PG_SSL', 'false'],
    ['TRUST_PROXY', 'true'],
    ['TRUST_PROXY', '1'],
  ]) {
    const saved = process.env[key];
    process.env[key] = value;
    assert.throws(validateSecurityConfig);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  process.env.REDIS_ENABLED = 'invalid';
  assert.throws(validateSecurityConfig, /REDIS_ENABLED/);
});
it('allows production to use in-memory rate limits when Redis is disabled', (t) => {
  env(t, {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    CORS_ORIGINS: 'https://pitwall.example',
    REDIS_ENABLED: 'false',
    REDIS_URL: undefined,
    PG_SSL: undefined,
    TRUST_PROXY: undefined,
  });
  const config = validateSecurityConfig();
  assert.equal(config.production, true);
  assert.equal(config.redisEnabled, false);
});
it('uses memory rate limits when Redis is disabled even if a URL is present', async (t) => {
  env(t, {
    REDIS_ENABLED: 'false',
    REDIS_URL: 'redis://127.0.0.1:1',
  });
  const service = new RateLimitService();
  t.after(() => service.onApplicationShutdown());
  assert.equal((await service.configure()).length, 2);
});
it('does not return password hashes or internal fields from registration', async () => {
  let count = 0;
  const service = new services.authService({
    query: async () => ({
      rows: count++
        ? [{ id: 'owner', email: 'a@example.com', password: 'hash', reset_token: 'internal' }]
        : [],
    }),
  });
  const result = await service.register({ email: 'a@example.com', password: 'long-password' });
  assert.deepEqual(result.user, { id: 'owner', email: 'a@example.com' });
});
it('rejects unverified Google emails and unsafe implicit account linking', async (t) => {
  env(t, { GOOGLE_CLIENT_ID: 'test-client' });
  for (const verified of [false, true]) {
    const service = new services.authService({
      query: async () => ({
        rows: [{ id: 'owner', email: 'a@third-party.example', password: 'hash' }],
      }),
    });
    t.mock.method(service.client, 'verifyIdToken', async () => ({
      getPayload: () => ({
        sub: 'google-id',
        email: 'a@third-party.example',
        email_verified: verified,
      }),
    }));
    await assert.rejects(service.googleLogin('token'), /Invalid Google token/);
  }
});
it('rejects dangerous keys and excessively nested JSON before admin services', async (t) => {
  const { http } = await setup(t, {
    adminService: {
      create() {
        throw new Error('must not reach service');
      },
    },
  });
  await request(http)
    .post('/admin/trivia')
    .set('Authorization', token('admin'))
    .type('json')
    .send('{"__proto__":{"polluted":true}}')
    .expect(400);
  let body = { value: 'x' };
  for (let i = 0; i < 20; i++) body = { nested: body };
  await request(http)
    .post('/admin/trivia')
    .set('Authorization', token('admin'))
    .send(body)
    .expect(400);
});
it('serializes sync work across different controllers and releases the gate after completion', async (t) => {
  let finish;
  let began;
  const started = new Promise((resolve) => (began = resolve));
  const pending = new Promise((resolve) => (finish = resolve));
  const { http } = await setup(t, {
    driverService: {
      syncDriverSeason: () => {
        began();
        return pending;
      },
    },
    constructorService: { syncConstructorSeason: async () => ({ ok: true }) },
  });
  const first = request(http)
    .get('/drivers/sync-driver-season')
    .set('Authorization', token('admin'))
    .then((res) => res);
  await started;
  await request(http)
    .get('/constructors/sync-constructor-season')
    .set('Authorization', token('admin'))
    .expect(409);
  finish({ ok: true });
  assert.equal((await first).status, 200);
  await request(http)
    .get('/constructors/sync-constructor-season')
    .set('Authorization', token('admin'))
    .expect(200);
});
it('coalesces lap fetches, bounds the cache, and releases pending work', async (t) => {
  const axios = (await import('axios')).default;
  let calls = 0;
  t.mock.method(axios, 'get', async (_url, options) => {
    calls++;
    assert.equal(options.timeout, 10000);
    assert.equal(options.maxRedirects, 0);
    return {
      data: {
        MRData: {
          total: '1',
          RaceTable: {
            Races: [{ Laps: [{ number: '1', Timings: [{ driverId: 'norris', position: '1' }] }] }],
          },
        },
      },
    };
  });
  const service = new services.resultService({});
  for (let i = 0; i < 50; i++) service.lapPositionsCache.set(String(i), {});
  const [a, b] = await Promise.all([
    service.getLapPositions('2026', '1'),
    service.getLapPositions('2026', '1'),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(service.lapPositionsCache.size, 50);
  assert.equal(service.pendingLaps.size, 0);
});
it('disconnects an SSE consumer when its buffered output exceeds the limit', () => {
  const { EventEmitter } = require('node:events');
  const { LiveController } = require('../dist/live/live.controller.js');
  let subscriber;
  const response = new EventEmitter();
  Object.assign(response, {
    writableLength: 0,
    destroyed: false,
    writeHead() {},
    flushHeaders() {},
    write() {},
    end() {},
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
  });
  const controller = new LiveController({
    addSubscriber(callbacks) {
      subscriber = callbacks;
      return () => {};
    },
    getState: () => ({}),
  });
  controller.streamLive(response);
  response.writableLength = 300 * 1024;
  subscriber.onUpdate({});
  assert.equal(response.destroyed, true);
});
it('prevents Google account pre-hijacking even for verified Gmail addresses', async (t) => {
  env(t, { GOOGLE_CLIENT_ID: 'test-client' });
  for (const existing of [
    { id: 'google-id', password: 'attacker-chosen-hash' },
    { id: 'different-google-subject' },
  ]) {
    const service = new services.authService({
      query: async () => ({ rows: [{ ...existing, email: 'owner@gmail.com' }] }),
    });
    t.mock.method(service.client, 'verifyIdToken', async () => ({
      getPayload: () => ({ sub: 'google-id', email: 'owner@gmail.com', email_verified: true }),
    }));
    await assert.rejects(service.googleLogin('token'), /Invalid Google token/);
  }
});
it('selects the verified Supabase trust anchor only for Supabase hosts', async (t) => {
  env(t, {
    PG_HOST: 'test.pooler.supabase.com',
    PG_SSL_CA: undefined,
    PG_SSL_CA_FILE: undefined,
    PG_SSL: undefined,
  });
  const { X509Certificate } = require('node:crypto');
  const hosted = new DatabaseService();
  t.after(() => hosted.onApplicationShutdown());
  const certificate = new X509Certificate(hosted.pool.options.ssl.ca);
  assert.equal(
    certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa',
  );
  assert.equal(hosted.pool.options.ssl.rejectUnauthorized, true);
  process.env.PG_HOST = 'database.example.com';
  const other = new DatabaseService();
  t.after(() => other.onApplicationShutdown());
  assert.equal(other.pool.options.ssl.ca, undefined);
});
