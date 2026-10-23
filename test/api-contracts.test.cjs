const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp, services } = require('./helpers.cjs');
const fixtures = require('./fixtures/express-contracts.json');

// Recorded from the original Express server with deterministic service doubles.
// Check both HTTP output and service arguments: matching output alone can mask
// dropped query parameters or a controller calling the wrong service method.
describe('API compatibility with intentional security changes', () => {
  let app, document, scenario, calls;
  const secret = 'contract-test-secret';
  const admin = {
    id: 'user-1',
    email: 'test@example.com',
    full_name: 'Test User',
    avatar_url: null,
    is_admin: true,
  };
  const result = { marker: 'service-result', simulated: true, replay: { paused: false } };
  const db = {
    query: async (sql) => {
      if (sql === 'SELECT NOW()') {
        if (scenario.mode === 'error') throw new Error('Service failed');
        return { rows: [{ now: '2026-01-01T00:00:00.000Z' }] };
      }
      if (scenario.auth === 'db-error') throw new Error('Database unavailable');
      return {
        rows:
          scenario.auth === 'deleted'
            ? []
            : [{ ...admin, is_admin: scenario.auth !== 'non-admin' }],
      };
    },
  };

  before(async () => {
    process.env.JWT_SECRET = secret;
    // Exercise contract cases without exhausting the budgets tested in security.test.cjs.
    for (const key of [
      'RATE_LIMIT_PUBLIC',
      'RATE_LIMIT_AUTH',
      'RATE_LIMIT_EXPENSIVE',
      'RATE_LIMIT_AUTH_GLOBAL',
    ])
      process.env[key] = '10000';
    process.env.CORS_ORIGINS = 'https://example.com';
    const overrides = Object.fromEntries(Object.keys(services).map((name) => [name, {}]));
    for (const item of fixtures.cases)
      for (const call of item.expected.calls) {
        overrides[call.service][call.method] = (...args) => {
          calls.push({ service: call.service, method: call.method, args });
          if (['error', 'status-error'].includes(scenario.mode)) {
            throw Object.assign(
              new Error('Service failed'),
              scenario.mode === 'status-error' ? { status: 422 } : {},
            );
          }
          return scenario.mode === 'null' ? null : result;
        };
      }
    ({ app, document } = await createApp(db, overrides));
  });
  after(async () => {
    if (app) await app.close();
  });

  for (const item of fixtures.cases) {
    it(`${item.method.toUpperCase()} ${item.url} (${item.auth || item.mode})`, async () => {
      scenario = item;
      calls = [];
      let req = request(app.getHttpServer())[item.method](item.url);
      if (item.auth !== 'missing') {
        const token =
          item.auth === 'invalid'
            ? 'bad-token'
            : jwt.sign({ id: admin.id }, secret, {
                expiresIn: item.auth === 'expired' ? -1 : 3600,
              });
        req = req.set('Authorization', 'Bearer ' + token);
      }
      const fields =
        item.url === '/auth/register'
          ? ['email', 'password', 'fullName']
          : item.url === '/auth/login'
            ? ['email', 'password']
            : item.url === '/auth/google'
              ? ['idToken']
              : item.url.startsWith('/profile/')
                ? ['fav_constructor', 'fav_drivers']
                : item.url === '/account/delete-request'
                  ? ['userId', 'email', 'reason']
                  : item.url === '/live/replay/start'
                    ? ['path', 'name', 'speed']
                    : item.url.startsWith('/live/replay/')
                      ? ['speed', 'offsetMs']
                      : null;
      const body =
        fields && item.body
          ? Object.fromEntries(Object.entries(item.body).filter(([key]) => fields.includes(key)))
          : item.body;
      if (body) req = req.send(body);
      const response = await req;
      if (item.url === '/health') {
        assert.ok(Number.isFinite(Date.parse(response.body.timestamp)));
        response.body.timestamp = '<ISO timestamp>';
      }
      assert.equal(response.status, item.expected.status);
      if (item.expected.status >= 500) {
        assert.deepEqual(response.body, { message: 'Internal server error' });
      } else if (item.body && Object.keys(item.body).length === 0) {
        assert.equal(response.body.message, 'Invalid request body');
        assert.ok(response.body.errors.length);
      } else if (item.url.startsWith('/auth/') && item.mode !== 'success') {
        assert.deepEqual(response.body, {
          message:
            item.url === '/auth/register' ? 'Unable to register account' : 'Invalid credentials',
        });
      } else assert.deepEqual(response.body, item.expected.body);
      const expectedCalls = structuredClone(item.expected.calls);
      if (fields && item.body)
        for (const call of expectedCalls) {
          call.args = call.args.map((arg) =>
            JSON.stringify(arg) === JSON.stringify(item.body) ? body : arg,
          );
        }
      assert.deepEqual(JSON.parse(JSON.stringify(calls)), expectedCalls);
    });
  }

  it('documents every original method and path, including the legacy driver alias', () => {
    const expected = fixtures.routes
      .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`)
      .sort();
    const actual = Object.entries(document.paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`))
      .sort();
    assert.deepEqual(actual, expected);
    assert.deepEqual(document.paths['/admin/verify'].get.security, [{ bearerAuth: [] }]);
    assert.equal(document.paths['/health'].get.security, undefined);
  });

  it('serves Swagger UI and the generated OpenAPI JSON', async () => {
    await request(app.getHttpServer())
      .get('/api-docs/')
      .expect(200)
      .expect(/swagger-ui/);
    const response = await request(app.getHttpServer()).get('/api-docs-json').expect(200);
    assert.equal(response.body.info.title, 'MyPitWall API Documentation');
  });

  it('allows configured CORS origins and handles preflight', async () => {
    await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'https://example.com');
  });

  it('rejects malformed and oversized JSON without reaching services', async () => {
    calls = [];
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'x'.repeat(110000) })
      .expect(413);
    assert.deepEqual(calls, []);
  });
});
