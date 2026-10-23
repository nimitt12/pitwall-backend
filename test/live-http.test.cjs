const { it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp, services } = require('./helpers.cjs');

async function stream(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const events = [];
      const waiters = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /event: (.+)\ndata: (.+)/.exec(frame);
          if (event) events.push({ event: event[1], data: JSON.parse(event[2]) });
        }
        for (const check of [...waiters]) check();
      });
      const ended = new Promise((r) => res.once('end', r));
      resolve({
        req,
        res,
        events,
        ended,
        waitFor(predicate) {
          return new Promise((done, fail) => {
            const timeout = setTimeout(() => fail(new Error('SSE event timed out')), 4000);
            const check = () => {
              const found = events.find(predicate);
              if (found) {
                clearTimeout(timeout);
                const i = waiters.indexOf(check);
                if (i !== -1) waiters.splice(i, 1);
                done(found);
              }
            };
            waiters.push(check);
            check();
          });
        },
      });
    });
    req.once('error', reject);
  });
}

it(
  'streams real simulator events and closes active SSE responses on Nest shutdown',
  { timeout: 10000 },
  async (t) => {
    const { app } = await createApp({
      query: async () => ({ rows: [{ id: 'admin', is_admin: true }] }),
    });
    t.after(() => app.close());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    await request(app.getHttpServer())
      .post('/live/simulate/start')
      .set(
        'Authorization',
        'Bearer ' + jwt.sign({ id: 'admin' }, process.env.JWT_SECRET, { expiresIn: 3600 }),
      )
      .expect(200)
      .expect({ status: 'Simulation running', simulated: true });
    const feed = await stream(base + '/live/stream');
    t.after(() => feed.req.destroy());
    assert.match(feed.res.headers['content-type'], /text\/event-stream/);
    assert.equal(feed.res.headers['x-accel-buffering'], 'no');
    const snapshot = await feed.waitFor((e) => e.event === 'snapshot');
    assert.equal(snapshot.data.simulated, true);
    assert.equal(snapshot.data.subscribers, 1);
    const update = await feed.waitFor((e) => e.event === 'update' && e.data.topic === 'TimingData');
    assert.ok(update.data.data.Lines['4']);
    await app.close();
    await feed.ended;
    assert.equal(app.get(services.liveTimingService).getState().subscribers, 0);
  },
);

it(
  'unsubscribes an SSE client when its response connection closes',
  { timeout: 10000 },
  async (t) => {
    const { app } = await createApp({ query: async () => ({ rows: [] }) });
    t.after(() => app.close());
    await app.listen(0, '127.0.0.1');
    const live = app.get(services.liveTimingService);
    live.startSimulation();
    const feed = await stream((await app.getUrl()) + '/live/stream');
    await feed.waitFor((e) => e.event === 'snapshot');
    feed.req.destroy();
    for (let i = 0; i < 50 && live.getState().subscribers; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(live.getState().subscribers, 0);
  },
);
