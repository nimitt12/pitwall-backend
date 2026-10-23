// Run separately with npm run test:redis. Starts an isolated, ephemeral Redis process.
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('./helpers.cjs');

it(
  'shares production limits across instances and restarts, and fails closed during Redis outages',
  { timeout: 20000 },
  async (t) => {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const directory = await mkdtemp(path.join(tmpdir(), 'pitwall-redis-test-'));
    const child = spawn(
      process.env.REDIS_SERVER_BIN || 'redis-server',
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        directory,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exited = new Promise((resolve) => child.once('exit', resolve));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Redis startup timed out')), 5000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Redis exited before startup'));
      });
      child.stdout.on('data', (data) => {
        if (String(data).includes('Ready to accept connections')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const previous = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-redis-production-secret-123456789',
      CORS_ORIGINS: 'https://pitwall.example',
      REDIS_ENABLED: 'true',
      REDIS_URL: `redis://127.0.0.1:${port}`,
      RATE_LIMIT_PUBLIC: '5',
    });
    delete process.env.PG_SSL;
    t.after(() => {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    });
    const db = { query: async () => ({ rows: [] }) };
    const first = (await createApp(db)).app;
    t.after(() => first.close());
    const second = (await createApp(db)).app;
    t.after(() => second.close());
    await request(first.getHttpServer()).get('/health').expect(200);
    await request(second.getHttpServer()).get('/health').expect(200);
    await request(first.getHttpServer()).get('/api-docs').expect(404);
    await request(second.getHttpServer()).get('/api-docs-json').expect(404);
    const secure = await request(first.getHttpServer()).get('/health').expect(200);
    assert.match(secure.headers['strict-transport-security'], /max-age=/);
    await request(second.getHttpServer()).get('/health').expect(429);
    await first.close();
    const restarted = (await createApp(db)).app;
    t.after(() => restarted.close());
    await request(restarted.getHttpServer()).get('/health').expect(429);
    child.kill('SIGTERM');
    await exited;
    const begin = Date.now();
    await request(second.getHttpServer()).get('/health').expect(503);
    assert.ok(Date.now() - begin < 4000, 'Redis outage must not hang requests');
  },
);
